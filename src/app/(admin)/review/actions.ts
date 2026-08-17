"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireInternal, recordActivity } from "@/lib/auth";
import { moveApplicationToStage } from "@/lib/funnel";
import { reviewTargets } from "@/lib/review";

export type ReviewDecision = { ok: boolean; message: string };

const schema = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["shortlist", "reject"]),
  note: z.string().max(2000).optional(),
});

/**
 * Records a shortlist or reject from the Review screen.
 *
 * Returns a result rather than redirecting: the screen advances to the next candidate on the
 * client so a decision doesn't cost a full page load, which is the whole point of reviewing a
 * batch in one sitting.
 */
export async function decideAction(input: {
  applicationId: string;
  decision: "shortlist" | "reject";
  note?: string;
}): Promise<ReviewDecision> {
  const user = await requireInternal();

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That decision wasn't understood." };

  const targets = await reviewTargets();
  const stage = parsed.data.decision === "shortlist" ? targets.shortlist : targets.reject;

  if (!stage) {
    return {
      ok: false,
      message:
        parsed.data.decision === "shortlist"
          ? "No stage to shortlist into — add an active stage after the entry stage in Settings."
          : "No rejection stage configured — add a stage of type Lost in Settings.",
    };
  }

  try {
    await moveApplicationToStage({
      applicationId: parsed.data.applicationId,
      toStageId: stage.id,
      changedByUserId: user.id,
      reasonCode: `review_${parsed.data.decision}`,
      note: parsed.data.note?.trim() || null,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't record that decision.",
    };
  }

  if (parsed.data.note?.trim()) {
    await prisma.note.create({
      data: {
        applicationId: parsed.data.applicationId,
        authorUserId: user.id,
        body: parsed.data.note.trim(),
        // Internal by default — sharing with the agency stays a deliberate act elsewhere.
        visibility: "INTERNAL",
      },
    });
  }

  await recordActivity({
    actorUserId: user.id,
    entityType: "application",
    entityId: parsed.data.applicationId,
    action: `review_${parsed.data.decision}`,
    meta: { toStage: stage.slug },
  });

  revalidatePath("/review");
  revalidatePath("/funnel");

  return { ok: true, message: `Moved to ${stage.name}.` };
}
