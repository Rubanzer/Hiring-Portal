"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { createSession, hashToken, landingPathFor, recordActivity } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export type SetPasswordState = { error?: string };

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(1),
  confirm: z.string().min(1),
});

/**
 * Consumes an invite or reset token and sets the password.
 *
 * The token is single-use and the update is transactional: marking it used and writing the
 * new hash succeed or fail together, so a crash can never burn a token without setting a
 * password. Every other session for that user is dropped, which is what makes a reset useful
 * after a suspected compromise.
 */
export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "That link is missing information. Request a new one." };

  const { token, password, confirm } = parsed.data;

  if (!checkRateLimit(`set-password:${hashToken(token)}`, 10, 15 * 60_000).allowed) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  if (password !== confirm) return { error: "The two passwords don't match." };

  const strengthError = validatePasswordStrength(password);
  if (strengthError) return { error: strengthError };

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!invitation || invitation.usedAt || invitation.expiresAt < new Date()) {
    return { error: "This link has expired or has already been used. Ask for a new one." };
  }
  if (!invitation.user.isActive) {
    return { error: "This account has been deactivated. Contact your administrator." };
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: invitation.userId },
      data: { passwordHash },
    }),
    // Any session opened before the password changed is no longer trustworthy.
    prisma.session.deleteMany({ where: { userId: invitation.userId } }),
  ]);

  await recordActivity({
    actorUserId: invitation.userId,
    entityType: "user",
    entityId: invitation.userId,
    action: invitation.type === "INVITE" ? "invite_accepted" : "password_reset",
  });

  await createSession(invitation.userId);
  redirect(landingPathFor(invitation.user.role));
}
