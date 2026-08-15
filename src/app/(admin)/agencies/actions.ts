"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordActivity } from "@/lib/auth";
import { inviteUser } from "@/lib/invites";
import { normalizeEmail, slugify } from "@/lib/normalize";

export type ActionState = { error?: string; success?: string; inviteUrl?: string };

const createAgencySchema = z.object({
  name: z.string().min(2, "Agency name is required.").max(120),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  ownershipWindowDays: z.coerce
    .number()
    .int()
    .min(0, "Ownership window can't be negative.")
    .max(730, "Ownership windows longer than two years are almost certainly a typo."),
  commissionNotes: z.string().max(2000).optional(),
});

export async function createAgencyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = createAgencySchema.safeParse({
    name: formData.get("name"),
    contactEmail: formData.get("contactEmail"),
    contactPhone: formData.get("contactPhone"),
    ownershipWindowDays: formData.get("ownershipWindowDays") || 90,
    commissionNotes: formData.get("commissionNotes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const base = slugify(parsed.data.name) || "agency";
  const slug = await uniqueSlug(base);

  const agency = await prisma.agency.create({
    data: {
      name: parsed.data.name.trim(),
      slug,
      contactEmail: normalizeEmail(parsed.data.contactEmail),
      contactPhone: parsed.data.contactPhone?.trim() || null,
      ownershipWindowDays: parsed.data.ownershipWindowDays,
      commissionNotes: parsed.data.commissionNotes?.trim() || null,
    },
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "agency",
    entityId: agency.id,
    action: "agency_created",
    meta: { name: agency.name },
  });

  revalidatePath("/agencies");
  return { success: `${agency.name} created. Add a login for them below.` };
}

/** Appends -2, -3… until the slug is free, so two "Talent Partners" can coexist. */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (await prisma.agency.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

const updateAgencySchema = createAgencySchema.extend({
  agencyId: z.string().uuid(),
  status: z.enum(["ACTIVE", "PAUSED"]),
});

export async function updateAgencyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = updateAgencySchema.safeParse({
    agencyId: formData.get("agencyId"),
    name: formData.get("name"),
    contactEmail: formData.get("contactEmail"),
    contactPhone: formData.get("contactPhone"),
    ownershipWindowDays: formData.get("ownershipWindowDays") || 90,
    commissionNotes: formData.get("commissionNotes"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.agency.update({
    where: { id: parsed.data.agencyId },
    data: {
      name: parsed.data.name.trim(),
      contactEmail: normalizeEmail(parsed.data.contactEmail),
      contactPhone: parsed.data.contactPhone?.trim() || null,
      ownershipWindowDays: parsed.data.ownershipWindowDays,
      commissionNotes: parsed.data.commissionNotes?.trim() || null,
      status: parsed.data.status,
    },
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "agency",
    entityId: parsed.data.agencyId,
    action: "agency_updated",
    meta: { status: parsed.data.status },
  });

  revalidatePath(`/agencies/${parsed.data.agencyId}`);
  revalidatePath("/agencies");
  return { success: "Agency updated." };
}

const createAgencyUserSchema = z.object({
  agencyId: z.string().uuid(),
  name: z.string().min(2, "Name is required.").max(120),
  email: z.string().min(3, "Email is required."),
  phone: z.string().optional(),
  role: z.enum(["AGENCY_OWNER", "AGENCY_RECRUITER"]),
});

/**
 * Creates a login for an agency and emails the invite.
 *
 * The account is created with no password hash: it can only be activated through the invite
 * link, so there is never a default credential to guess.
 */
export async function createAgencyUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = createAgencyUserSchema.safeParse({
    agencyId: formData.get("agencyId"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = normalizeEmail(parsed.data.email);
  if (!email) return { error: "That doesn't look like a valid email address." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: `${email} already has an account on the portal.` };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name.trim(),
      phone: parsed.data.phone?.trim() || null,
      role: parsed.data.role,
      agencyId: parsed.data.agencyId,
      passwordHash: null,
    },
  });

  const invite = await inviteUser(user.id);

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: user.id,
    action: "agency_user_created",
    meta: { email, agencyId: parsed.data.agencyId },
  });

  revalidatePath(`/agencies/${parsed.data.agencyId}`);
  return {
    success: invite.emailed
      ? `Invite emailed to ${email}.`
      : `Account created. Email isn't configured, so send them this link yourself.`,
    inviteUrl: invite.emailed ? undefined : invite.url,
  };
}

const assignRoleSchema = z.object({
  agencyId: z.string().uuid(),
  jobRoleId: z.string().uuid(),
  submissionLimit: z.string().optional(),
});

export async function assignRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = assignRoleSchema.safeParse({
    agencyId: formData.get("agencyId"),
    jobRoleId: formData.get("jobRoleId"),
    submissionLimit: formData.get("submissionLimit"),
  });
  if (!parsed.success) return { error: "Pick a role to assign." };

  const rawLimit = parsed.data.submissionLimit?.trim();
  const submissionLimit = rawLimit ? Number.parseInt(rawLimit, 10) : null;
  if (submissionLimit !== null && (!Number.isFinite(submissionLimit) || submissionLimit < 1)) {
    return { error: "Submission limit must be a whole number of at least 1, or left blank." };
  }

  await prisma.agencyJobAssignment.upsert({
    where: {
      agencyId_jobRoleId: {
        agencyId: parsed.data.agencyId,
        jobRoleId: parsed.data.jobRoleId,
      },
    },
    update: { isActive: true, submissionLimit },
    create: {
      agencyId: parsed.data.agencyId,
      jobRoleId: parsed.data.jobRoleId,
      submissionLimit,
      assignedByUserId: admin.id,
    },
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "agency",
    entityId: parsed.data.agencyId,
    action: "role_assigned",
    meta: { jobRoleId: parsed.data.jobRoleId, submissionLimit },
  });

  revalidatePath(`/agencies/${parsed.data.agencyId}`);
  return { success: "Role assigned. The agency can now submit candidates for it." };
}

/**
 * Revokes access to a role. The assignment row is kept (deactivated) rather than deleted, so
 * already-submitted candidates keep their provenance and the history of who had access when
 * stays intact.
 */
export async function revokeRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) return;

  const assignment = await prisma.agencyJobAssignment.update({
    where: { id: assignmentId },
    data: { isActive: false },
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "agency",
    entityId: assignment.agencyId,
    action: "role_revoked",
    meta: { jobRoleId: assignment.jobRoleId },
  });

  revalidatePath(`/agencies/${assignment.agencyId}`);
}
