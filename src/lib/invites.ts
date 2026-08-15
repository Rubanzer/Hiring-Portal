import "server-only";
import { prisma } from "./db";
import { generateToken, hashToken } from "./auth";
import { sendInviteEmail, sendPasswordResetEmail } from "./email";
import { env } from "./env";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Issues an invite or reset link.
 *
 * Only the hash is stored; the raw token exists in the email and in the return value. The
 * link is returned to the caller as well so an admin can copy it manually — which matters
 * because agencies routinely have aggressive spam filters, and email delivery should not be
 * the only path to onboarding someone.
 */
export async function issueInvite(params: {
  userId: string;
  type: "INVITE" | "PASSWORD_RESET";
}) {
  const token = generateToken();
  const ttl = params.type === "INVITE" ? INVITE_TTL_MS : RESET_TTL_MS;

  // Supersede any outstanding link of the same kind, so a re-sent invite invalidates the old.
  await prisma.invitation.updateMany({
    where: { userId: params.userId, type: params.type, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.invitation.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(token),
      type: params.type,
      expiresAt: new Date(Date.now() + ttl),
    },
  });

  return { token, url: `${env().APP_URL}/set-password?token=${token}` };
}

/** Creates the link and emails it. Returns the link so the UI can offer a copyable fallback. */
export async function inviteUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { agency: true },
  });
  if (!user) throw new Error("User not found");

  const { token, url } = await issueInvite({ userId, type: "INVITE" });
  const result = await sendInviteEmail({
    to: user.email,
    name: user.name,
    token,
    agencyName: user.agency?.name ?? null,
  });

  return { url, emailed: result.sent };
}

export async function sendReset(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const { token, url } = await issueInvite({ userId, type: "PASSWORD_RESET" });
  const result = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token,
  });

  return { url, emailed: result.sent };
}
