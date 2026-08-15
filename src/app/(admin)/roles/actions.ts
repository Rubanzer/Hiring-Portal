"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireInternal, recordActivity } from "@/lib/auth";
import { knockoutRuleSchema } from "@/lib/screening";
import type { FormState } from "@/components/action-form";

const roleSchema = z.object({
  title: z.string().min(2, "Role title is required.").max(160),
  department: z.string().max(120).optional(),
  location: z.string().max(160).optional(),
  employmentType: z.string().max(60).optional(),
  description: z.string().max(20000).optional(),
  openings: z.coerce.number().int().min(1).max(999),
  minExperienceMonths: z.string().optional(),
  maxBudgetCtc: z.string().optional(),
  status: z.enum(["DRAFT", "OPEN", "PAUSED", "CLOSED"]),
});

function optionalInt(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function createRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();

  const parsed = roleSchema.safeParse({
    title: formData.get("title"),
    department: formData.get("department"),
    location: formData.get("location"),
    employmentType: formData.get("employmentType"),
    description: formData.get("description"),
    openings: formData.get("openings") || 1,
    minExperienceMonths: formData.get("minExperienceMonths"),
    maxBudgetCtc: formData.get("maxBudgetCtc"),
    status: formData.get("status") || "DRAFT",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const role = await prisma.jobRole.create({
    data: {
      title: parsed.data.title.trim(),
      department: parsed.data.department?.trim() || null,
      location: parsed.data.location?.trim() || null,
      employmentType: parsed.data.employmentType?.trim() || null,
      description: parsed.data.description?.trim() || null,
      openings: parsed.data.openings,
      minExperienceMonths: optionalInt(parsed.data.minExperienceMonths),
      maxBudgetCtc: optionalInt(parsed.data.maxBudgetCtc),
      status: parsed.data.status,
      createdByUserId: user.id,
    },
  });

  await recordActivity({
    actorUserId: user.id,
    entityType: "job_role",
    entityId: role.id,
    action: "role_created",
    meta: { title: role.title },
  });

  revalidatePath("/roles");
  redirect(`/roles/${role.id}`);
}

export async function updateRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) return { error: "No role specified." };

  const parsed = roleSchema.safeParse({
    title: formData.get("title"),
    department: formData.get("department"),
    location: formData.get("location"),
    employmentType: formData.get("employmentType"),
    description: formData.get("description"),
    openings: formData.get("openings") || 1,
    minExperienceMonths: formData.get("minExperienceMonths"),
    maxBudgetCtc: formData.get("maxBudgetCtc"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.jobRole.update({
    where: { id: roleId },
    data: {
      title: parsed.data.title.trim(),
      department: parsed.data.department?.trim() || null,
      location: parsed.data.location?.trim() || null,
      employmentType: parsed.data.employmentType?.trim() || null,
      description: parsed.data.description?.trim() || null,
      openings: parsed.data.openings,
      minExperienceMonths: optionalInt(parsed.data.minExperienceMonths),
      maxBudgetCtc: optionalInt(parsed.data.maxBudgetCtc),
      status: parsed.data.status,
    },
  });

  await recordActivity({
    actorUserId: user.id,
    entityType: "job_role",
    entityId: roleId,
    action: "role_updated",
    meta: { status: parsed.data.status },
  });

  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/roles");
  return { success: "Role saved." };
}

const questionSchema = z.object({
  /** Existing questions carry their uuid; new ones send a client-generated "new-*" id. */
  id: z.string(),
  label: z.string().min(1, "Every question needs a label.").max(300),
  helpText: z.string().max(500).optional().nullable(),
  type: z.enum([
    "TEXT",
    "LONG_TEXT",
    "NUMBER",
    "CURRENCY",
    "BOOLEAN",
    "SINGLE_SELECT",
    "MULTI_SELECT",
    "DATE",
  ]),
  options: z.array(z.string()).optional().nullable(),
  isRequired: z.boolean(),
  isKnockout: z.boolean(),
  knockoutRule: knockoutRuleSchema.nullable().optional(),
});

/**
 * Replaces a role's question set in one transaction.
 *
 * Questions that disappear from the payload are deleted, which cascades to their answers.
 * That is intentional and irreversible — the UI warns before removing a question that
 * already has answers, because the alternative (soft-deleting forever) leaves the submit
 * form quietly carrying questions nobody wants.
 */
export async function saveQuestionsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInternal();
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) return { error: "No role specified." };

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("questions") ?? "[]"));
  } catch {
    return { error: "Couldn't read the question list. Reload and try again." };
  }

  const parsed = z.array(questionSchema).safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "One of the questions is invalid." };
  }

  const questions = parsed.data;

  // A select question with no options can never be answered.
  for (const q of questions) {
    if (
      (q.type === "SINGLE_SELECT" || q.type === "MULTI_SELECT") &&
      (!q.options || q.options.filter((o) => o.trim()).length === 0)
    ) {
      return { error: `"${q.label}" is a choice question but has no options.` };
    }
    if (q.isKnockout && !q.knockoutRule) {
      return { error: `"${q.label}" is marked as a knockout but has no rule set.` };
    }
  }

  const keptIds = questions.filter((q) => !q.id.startsWith("new-")).map((q) => q.id);

  await prisma.$transaction(async (tx) => {
    await tx.screeningQuestion.deleteMany({
      where: { jobRoleId: roleId, id: { notIn: keptIds.length ? keptIds : ["-"] } },
    });

    for (const [index, q] of questions.entries()) {
      const data = {
        label: q.label.trim(),
        helpText: q.helpText?.trim() || null,
        type: q.type,
        options: q.options?.length ? (q.options.filter(Boolean) as never) : undefined,
        isRequired: q.isRequired,
        sortOrder: index,
        isKnockout: q.isKnockout,
        knockoutRule: (q.isKnockout ? q.knockoutRule : null) as never,
      };

      if (q.id.startsWith("new-")) {
        await tx.screeningQuestion.create({ data: { ...data, jobRoleId: roleId } });
      } else {
        await tx.screeningQuestion.update({ where: { id: q.id }, data });
      }
    }
  });

  await recordActivity({
    actorUserId: user.id,
    entityType: "job_role",
    entityId: roleId,
    action: "questions_saved",
    meta: { count: questions.length },
  });

  revalidatePath(`/roles/${roleId}`);
  return { success: `Saved ${questions.length} question${questions.length === 1 ? "" : "s"}.` };
}
