"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordActivity } from "@/lib/auth";
import { inviteUser, sendReset } from "@/lib/invites";
import { normalizeEmail } from "@/lib/normalize";
import { hashPassword } from "@/lib/password";
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

/**
 * Deletes a login, keeping everything the person did.
 *
 * Every record that references a user does so with `onDelete: SetNull` — applications they
 * submitted, notes they wrote, stages they moved candidates through, files they uploaded. Only
 * their sessions and unused invitations cascade away, which is what you want. So the funnel,
 * the agency's submission counts and the duplicate-claim evidence all survive intact; the
 * submissions simply stop naming a person, while still being credited to their agency.
 *
 * That is why this can be a real delete rather than a soft one. Disable is still the right
 * choice for someone on leave; this is for someone who has left.
 */
export async function deleteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "No user specified." };

  if (userId === admin.id) {
    return { error: "You can't delete the account you're signed in with." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, agencyId: true, _count: { select: { submittedApps: true } } },
  });
  if (!user) return { error: "User not found." };

  // The last admin standing would lock everyone out of user management permanently.
  const admins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (target?.role === "ADMIN" && admins <= 1) {
    return { error: "That's the only administrator. Make someone else an admin first." };
  }

  await prisma.user.delete({ where: { id: userId } });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: userId,
    action: "user_deleted",
    meta: { email: user.email, agencyId: user.agencyId },
  });

  revalidatePath("/users");
  if (user.agencyId) revalidatePath(`/agencies/${user.agencyId}`);

  return {
    success:
      user._count.submittedApps > 0
        ? `${user.name} deleted. Their ${user._count.submittedApps} submission${user._count.submittedApps === 1 ? "" : "s"} stay in the funnel, still credited to the agency.`
        : `${user.name} deleted.`,
  };
}

/**
 * Sets a password on someone's behalf and shows it once.
 *
 * The case this exists for: an agency has lost their password and wants it sorted on the phone,
 * not through an email round trip. Rather than storing passwords readably so they can be looked
 * up — which would put agencies' credentials, reused elsewhere as they always are, in a database
 * that only needs to hold candidate data — you just set a new one and read it out.
 *
 * Their existing sessions are dropped, so a laptop left signed in somewhere doesn't keep access
 * after the password changes.
 */
const setPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(12, "Use at least 12 characters."),
});

export async function setUserPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = setPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { email: true, name: true, agencyId: true },
  });
  if (!user) return { error: "User not found." };

  await prisma.$transaction([
    prisma.user.update({
      where: { id: parsed.data.userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    }),
    prisma.session.deleteMany({ where: { userId: parsed.data.userId } }),
    // Any outstanding invite or reset link is now moot, and leaving it live would be a second
    // way into the account that you don't know about.
    prisma.invitation.updateMany({
      where: { userId: parsed.data.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  await recordActivity({
    actorUserId: admin.id,
    entityType: "user",
    entityId: parsed.data.userId,
    action: "password_set_by_admin",
    meta: { email: user.email },
  });

  revalidatePath("/users");
  if (user.agencyId) revalidatePath(`/agencies/${user.agencyId}`);

  return {
    success: `Password set for ${user.email}. Pass this on — it isn't shown again.`,
    inviteUrl: parsed.data.password,
  };
}
