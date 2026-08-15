"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordActivity } from "@/lib/auth";
import { inviteUser, sendReset } from "@/lib/invites";
import { normalizeEmail } from "@/lib/normalize";
import type { FormState } from "@/components/action-form";

const createUserSchema = z.object({
  name: z.string().min(2, "Name is required.").max(120),
  email: z.string().min(3, "Email is required."),
  phone: z.string().optional(),
  role: z.enum(["ADMIN", "RECRUITER"]),
});

/** Creates an internal teammate. Agency logins are created from the agency's own page. */
export async function createInternalUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = normalizeEmail(parsed.data.email);
  if (!email) return { error: "That doesn't look like a valid email address." };

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: `${email} already has an account.` };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name.trim(),
      phone: parsed.data.phone?.trim() || null,
      role: parsed.data.role,
      agencyId: null,
      passwordHash: null,
    },
  });

  const invite = await inviteUser(user.id);

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: user.id,
    action: "internal_user_created",
    meta: { email, role: parsed.data.role },
  });

  revalidatePath("/users");
  return {
    success: invite.emailed
      ? `Invite emailed to ${email}.`
      : "Account created. Email isn't configured, so send them this link yourself.",
    inviteUrl: invite.emailed ? undefined : invite.url,
  };
}

/**
 * Enable/disable a login. Disabling also drops live sessions, so revoking access takes
 * effect on the next request rather than whenever their cookie happens to expire.
 */
export async function toggleUserActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "No user specified." };

  if (userId === admin.id) {
    return { error: "You can't deactivate your own account." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };

  const nextActive = !user.isActive;

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: nextActive } }),
    ...(nextActive ? [] : [prisma.session.deleteMany({ where: { userId } })]),
  ]);

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: userId,
    action: nextActive ? "user_enabled" : "user_disabled",
  });

  revalidatePath("/users");
  if (user.agencyId) revalidatePath(`/agencies/${user.agencyId}`);

  return {
    success: nextActive
      ? `${user.name} can sign in again.`
      : `${user.name} has been signed out and can no longer sign in.`,
  };
}

/** Re-sends an invite, or sends a reset link to someone who already has a password. */
export async function resendInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "No user specified." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };

  const result = user.passwordHash ? await sendReset(userId) : await inviteUser(userId);

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: userId,
    action: user.passwordHash ? "password_reset_sent" : "invite_resent",
  });

  revalidatePath("/users");
  return {
    success: result.emailed
      ? `Link emailed to ${user.email}.`
      : "Link generated. Email isn't configured, so pass this on yourself.",
    inviteUrl: result.emailed ? undefined : result.url,
  };
}
