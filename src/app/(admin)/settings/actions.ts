"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordActivity } from "@/lib/auth";
import { slugify } from "@/lib/normalize";
import type { FormState } from "@/components/action-form";

// --- Funnel stages -------------------------------------------------------

const stagesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string().min(1, "Every stage needs a name.").max(80),
    kind: z.enum(["ACTIVE", "WON", "LOST", "HOLD"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #0ea5e9."),
    visibleToAgency: z.boolean(),
    isDefault: z.boolean(),
  }),
);

/**
 * Saves the whole funnel in one go.
 *
 * Stages are never hard-deleted here — removing one from the list marks it inactive, because
 * applications and history rows point at it and deleting would orphan them. Inactive stages
 * disappear from the board but stay readable in a candidate's timeline.
 */
export async function saveStagesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("stages") ?? "[]"));
  } catch {
    return { error: "Couldn't read the stage list. Reload and try again." };
  }

  const parsed = stagesSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const stages = parsed.data;
  if (stages.length === 0) return { error: "Keep at least one stage." };
  if (!stages.some((s) => s.kind === "ACTIVE")) {
    return { error: "At least one stage must be an active pipeline stage." };
  }

  const defaults = stages.filter((s) => s.isDefault);
  if (defaults.length !== 1) {
    return { error: "Exactly one stage must be the entry stage for new candidates." };
  }
  if (defaults[0].kind !== "ACTIVE") {
    return { error: "The entry stage must be an active stage." };
  }

  const keptIds = stages.filter((s) => !s.id.startsWith("new-")).map((s) => s.id);

  await prisma.$transaction(async (tx) => {
    // Clear the default first: the partial unique index allows only one true at a time.
    await tx.stage.updateMany({ data: { isDefault: false }, where: { isDefault: true } });

    await tx.stage.updateMany({
      where: { id: { notIn: keptIds.length ? keptIds : ["-"] } },
      data: { isActive: false, isDefault: false },
    });

    for (const [index, stage] of stages.entries()) {
      const data = {
        name: stage.name.trim(),
        sortOrder: index,
        kind: stage.kind,
        color: stage.color,
        visibleToAgency: stage.visibleToAgency,
        isDefault: stage.isDefault,
        isActive: true,
      };

      if (stage.id.startsWith("new-")) {
        await tx.stage.create({
          data: { ...data, slug: await uniqueStageSlug(tx, slugify(stage.name)) },
        });
      } else {
        await tx.stage.update({ where: { id: stage.id }, data });
      }
    }
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "stage",
    action: "stages_saved",
    meta: { count: stages.length },
  });

  revalidatePath("/settings");
  revalidatePath("/funnel");
  return { success: "Funnel saved." };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function uniqueStageSlug(tx: TxClient, base: string): Promise<string> {
  const root = base || "stage";
  let candidate = root;
  let n = 1;
  while (await tx.stage.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}
