import "server-only";
import { Resend } from "resend";
import { prisma } from "./db";
import { env, isEmailConfigured } from "./env";

/**
 * Transactional email.
 *
 * Every send is written to EmailLog first and updated with the outcome, so "did the agency
 * actually get told?" is a database question rather than a guess. When no provider is
 * configured the send is recorded as SKIPPED and the caller carries on — a missing API key
 * must never take down a submission.
 */

type Template =
  | "invite"
  | "password_reset"
  | "submission_received"
  | "stage_changed"
  | "agency_digest";

let resend: Resend | null = null;

function client(): Resend {
  resend ??= new Resend(env().RESEND_API_KEY!);
  return resend;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  template: Template;
  payload?: Record<string, unknown>;
}) {
  const log = await prisma.emailLog.create({
    data: {
      toEmail: params.to,
      template: params.template,
      payload: (params.payload ?? undefined) as never,
      status: "QUEUED",
    },
  });

  if (!isEmailConfigured()) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "SKIPPED", error: "No RESEND_API_KEY configured" },
    });
    return { sent: false as const, reason: "email-not-configured" };
  }

  try {
    const result = await client().emails.send({
      from: env().EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (result.error) throw new Error(result.error.message);

    await prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: result.data?.id ?? null,
      },
    });
    return { sent: true as const };
  } catch (error) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { sent: false as const, reason: "send-failed" };
  }
}

function layout(title: string, body: string) {
  return `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(title)}</h1>
    ${body}
    <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
      Sent by the Hiring Portal. If you weren't expecting this, you can ignore it.
    </p>
  </div>
</body></html>`;
}

function button(href: string, label: string) {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:500">${escapeHtml(label)}</a></p>`;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInviteEmail(params: {
  to: string;
  name: string;
  token: string;
  agencyName?: string | null;
}) {
  const url = `${env().APP_URL}/set-password?token=${params.token}`;
  const context = params.agencyName
    ? `You've been given access to the hiring portal for <strong>${escapeHtml(params.agencyName)}</strong>. From there you can submit candidates for the roles assigned to your agency and follow their progress.`
    : `You've been given access to the hiring portal.`;

  return sendEmail({
    to: params.to,
    template: "invite",
    subject: "Your hiring portal account",
    payload: { name: params.name },
    html: layout(
      `Hello ${params.name},`,
      `<p style="margin:0;line-height:1.6">${context}</p>
       ${button(url, "Set your password")}
       <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">This link expires in 7 days. If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${url}</span></p>`,
    ),
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  token: string;
}) {
  const url = `${env().APP_URL}/set-password?token=${params.token}`;
  return sendEmail({
    to: params.to,
    template: "password_reset",
    subject: "Reset your hiring portal password",
    html: layout(
      `Hello ${params.name},`,
      `<p style="margin:0;line-height:1.6">Someone asked to reset the password on your hiring portal account. If that was you, use the link below.</p>
       ${button(url, "Choose a new password")}
       <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">This link expires in 2 hours and can be used once. If you didn't request it, nothing has changed and you can ignore this email.</p>`,
    ),
  });
}

export async function sendStageChangedEmail(params: {
  to: string;
  agencyName: string;
  candidateName: string;
  roleTitle: string;
  stageLabel: string;
  feedback?: string | null;
}) {
  return sendEmail({
    to: params.to,
    template: "stage_changed",
    subject: `${params.candidateName} — ${params.stageLabel}`,
    payload: { candidateName: params.candidateName, stage: params.stageLabel },
    html: layout(
      `Update on ${params.candidateName}`,
      `<p style="margin:0;line-height:1.6"><strong>${escapeHtml(params.candidateName)}</strong>, submitted for <strong>${escapeHtml(params.roleTitle)}</strong>, has moved to <strong>${escapeHtml(params.stageLabel)}</strong>.</p>
       ${
         params.feedback
           ? `<div style="margin:20px 0;padding:14px 16px;background:#f1f5f9;border-radius:8px;line-height:1.6">${escapeHtml(params.feedback)}</div>`
           : ""
       }
       ${button(`${env().APP_URL}/agency/submissions`, "View your submissions")}`,
    ),
  });
}
