"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireInternal, recordActivity } from "@/lib/auth";
import { moveApplicationToStage, moveManyToStage } from "@/lib/funnel";
import { sendStageChangedEmail } from "@/lib/email";
import { agencyVisibleStage } from "@/lib/tenancy";
import type { FormState } from "@/components/action-form";

/**
 * Moves one application and, when the destination stage is agency-visible, tells the
 * submitting agency.
 *
 * The email is best-effort and deliberately after the transaction: a mail provider outage
 * must never roll back a stage change the recruiter has already seen happen on screen.
 */
export async function moveStageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();

  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      toStageId: z.string().uuid(),
      note: z.string().max(2000).optional(),
      reasonCode: z.string().max(100).optional(),
      notifyAgency: z.string().optional(),
    })
    .safeParse({
      applicationId: formData.get("applicationId"),
      toStageId: formData.get("toStageId"),
      note: formData.get("note") ?? undefined,
      reasonCode: formData.get("reasonCode") ?? undefined,
      notifyAgency: formData.get("notifyAgency") ?? undefined,
    });

  if (!parsed.success) return { error: "Pick a stage to move this candidate to." };

  try {
    const result = await moveApplicationToStage({
      applicationId: parsed.data.applicationId,
      toStageId: parsed.data.toStageId,
      changedByUserId: user.id,
      reasonCode: parsed.data.reasonCode || null,
      note: parsed.data.note || null,
    });

    if (!result.moved) {
      return { success: "That candidate is already in this stage." };
    }

    await recordActivity({
      actorUserId: user.id,
      entityType: "application",
      entityId: parsed.data.applicationId,
      action: "stage_changed",
      meta: { toStage: result.stage.slug },
    });

    if (parsed.data.notifyAgency === "on") {
      await notifyAgencyOfStage(parsed.data.applicationId, parsed.data.note ?? null);
    }

    revalidatePath("/funnel");
    revalidatePath(`/candidates/${parsed.data.applicationId}`);
    return { success: `Moved to ${result.stage.name}.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Couldn't move that candidate.",
    };
  }
}

/** Drag-and-drop path: same transition, no banner, just a revalidate. */
export async function quickMoveStageAction(formData: FormData) {
  const user = await requireInternal();
  const applicationId = String(formData.get("applicationId") ?? "");
  const toStageId = String(formData.get("toStageId") ?? "");
  if (!applicationId || !toStageId) return;

  const result = await moveApplicationToStage({
    applicationId,
    toStageId,
    changedByUserId: user.id,
    reasonCode: "board_drag",
  });

  if (result.moved) {
    await recordActivity({
      actorUserId: user.id,
      entityType: "application",
      entityId: applicationId,
      action: "stage_changed",
      meta: { toStage: result.stage.slug, via: "board" },
    });
  }

  revalidatePath("/funnel");
}

export async function bulkMoveStageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();

  const ids = formData.getAll("applicationIds").map(String).filter(Boolean);
  const toStageId = String(formData.get("toStageId") ?? "");

  if (!ids.length) return { error: "Select at least one candidate." };
  if (!toStageId) return { error: "Pick a stage to move them to." };

  const result = await moveManyToStage({
    applicationIds: ids,
    toStageId,
    changedByUserId: user.id,
    reasonCode: "bulk",
  });

  await recordActivity({
    actorUserId: user.id,
    entityType: "application",
    action: "bulk_stage_changed",
    meta: { count: result.moved, toStageId },
  });

  revalidatePath("/funnel");

  if (result.errors.length) {
    return {
      error: `Moved ${result.moved}, but ${result.errors.length} failed: ${result.errors[0]}`,
    };
  }
  return {
    success: `Moved ${result.moved} candidate${result.moved === 1 ? "" : "s"}.`,
  };
}

/** Emails the submitting agency the stage the candidate has reached, if they're allowed to see it. */
async function notifyAgencyOfStage(applicationId: string, feedback: string | null) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { select: { fullName: true } },
      jobRole: { select: { title: true } },
      currentStage: true,
      agency: { include: { users: { where: { isActive: true } } } },
    },
  });

  if (!application?.agency) return;

  const shown = agencyVisibleStage(application.currentStage);
  const recipients = application.agency.users
    .filter((u) => u.email)
    .map((u) => u.email);

  for (const to of recipients) {
    await sendStageChangedEmail({
      to,
      agencyName: application.agency.name,
      candidateName: application.candidate.fullName,
      roleTitle: application.jobRole.title,
      stageLabel: shown.label,
      feedback,
    });
  }
}

const noteSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().min(1, "Write something first.").max(5000),
  visibility: z.enum(["INTERNAL", "SHARED_WITH_AGENCY"]),
});

export async function addNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();

  const parsed = noteSchema.safeParse({
    applicationId: formData.get("applicationId"),
    body: formData.get("body"),
    visibility: formData.get("visibility") || "INTERNAL",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.note.create({
    data: {
      applicationId: parsed.data.applicationId,
      authorUserId: user.id,
      body: parsed.data.body.trim(),
      visibility: parsed.data.visibility,
    },
  });

  revalidatePath(`/candidates/${parsed.data.applicationId}`);
  return {
    success:
      parsed.data.visibility === "SHARED_WITH_AGENCY"
        ? "Note added and shared with the agency."
        : "Internal note added.",
  };
}

const interviewSchema = z.object({
  applicationId: z.string().uuid(),
  round: z.enum(["TELE", "R1", "R2", "R3"]),
  scheduledAt: z.string().min(1, "Pick a date and time."),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  mode: z.enum(["PHONE", "VIDEO", "ONSITE"]),
  locationOrLink: z.string().max(500).optional(),
  interviewerNames: z.string().max(500).optional(),
});

export async function scheduleInterviewAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();

  const parsed = interviewSchema.safeParse({
    applicationId: formData.get("applicationId"),
    round: formData.get("round"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes") || 45,
    mode: formData.get("mode"),
    locationOrLink: formData.get("locationOrLink") ?? undefined,
    interviewerNames: formData.get("interviewerNames") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return { error: "That date isn't valid." };

  await prisma.interview.create({
    data: {
      applicationId: parsed.data.applicationId,
      round: parsed.data.round,
      scheduledAt,
      durationMinutes: parsed.data.durationMinutes,
      mode: parsed.data.mode,
      locationOrLink: parsed.data.locationOrLink?.trim() || null,
      interviewerNames:
        parsed.data.interviewerNames
          ?.split(",")
          .map((n) => n.trim())
          .filter(Boolean) ?? [],
      createdByUserId: user.id,
    },
  });

  // Scheduling an interview IS the stage change, so the board reflects reality without a
  // second action nobody remembers to take.
  const scheduledStage = await prisma.stage.findUnique({
    where: { slug: "interview-scheduled" },
  });
  if (scheduledStage) {
    await moveApplicationToStage({
      applicationId: parsed.data.applicationId,
      toStageId: scheduledStage.id,
      changedByUserId: user.id,
      reasonCode: "interview_scheduled",
    }).catch(() => undefined);
  }

  revalidatePath(`/candidates/${parsed.data.applicationId}`);
  revalidatePath("/funnel");
  return { success: "Interview scheduled." };
}

const interviewOutcomeSchema = z.object({
  interviewId: z.string().uuid(),
  applicationId: z.string().uuid(),
  status: z.enum(["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"]),
  outcome: z.enum(["PASS", "FAIL", "HOLD", ""]).optional(),
  rating: z.string().optional(),
  feedback: z.string().max(5000).optional(),
});

export async function recordInterviewOutcomeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireInternal();

  const parsed = interviewOutcomeSchema.safeParse({
    interviewId: formData.get("interviewId"),
    applicationId: formData.get("applicationId"),
    status: formData.get("status"),
    outcome: formData.get("outcome") ?? "",
    rating: formData.get("rating") ?? undefined,
    feedback: formData.get("feedback") ?? undefined,
  });
  if (!parsed.success) return { error: "Couldn't save that outcome." };

  const rating = parsed.data.rating ? Number.parseInt(parsed.data.rating, 10) : null;

  await prisma.interview.update({
    where: { id: parsed.data.interviewId },
    data: {
      status: parsed.data.status,
      outcome: parsed.data.outcome ? parsed.data.outcome : null,
      rating: rating && rating >= 1 && rating <= 5 ? rating : null,
      feedback: parsed.data.feedback?.trim() || null,
    },
  });

  revalidatePath(`/candidates/${parsed.data.applicationId}`);
  return { success: "Interview updated." };
}

export async function assignOwnerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireInternal();
  const applicationId = String(formData.get("applicationId") ?? "");
  const ownerUserId = String(formData.get("ownerUserId") ?? "");

  if (!applicationId) return { error: "No candidate specified." };

  await prisma.application.update({
    where: { id: applicationId },
    data: { ownerUserId: ownerUserId || null },
  });

  revalidatePath(`/candidates/${applicationId}`);
  revalidatePath("/funnel");
  return { success: ownerUserId ? "Owner assigned." : "Owner cleared." };
}
