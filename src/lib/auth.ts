import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { env } from "./env";
import type { UserRole } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "hp_session";
const SESSION_TTL_DAYS = 14;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  agencyId: string | null;
  agencyName: string | null;
  agencySlug: string | null;
};

export const INTERNAL_ROLES: UserRole[] = ["ADMIN", "RECRUITER"];
export const AGENCY_ROLES: UserRole[] = ["AGENCY_OWNER", "AGENCY_RECRUITER"];

export function isInternal(role: UserRole) {
  return INTERNAL_ROLES.includes(role);
}

export function isAgency(role: UserRole) {
  return AGENCY_ROLES.includes(role);
}

/** Only the SHA-256 of a token is ever stored, so a database leak yields no usable sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent?.slice(0, 500) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolves the current user, or null. Wrapped in React's `cache` so a page that calls it from
 * the layout, the page and three components still hits the database once per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { agency: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;

  const { user } = session;
  if (!user.isActive) return null;
  // A paused agency loses access immediately, without touching each of its users.
  if (user.agency && user.agency.status === "PAUSED") return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    agencyId: user.agencyId,
    agencyName: user.agency?.name ?? null,
    agencySlug: user.agency?.slug ?? null,
  };
});

/** Any signed-in user. Redirects to login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** ADMIN or RECRUITER. Agency users get bounced to their own portal, not to a 403 page. */
export async function requireInternal(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isInternal(user.role)) redirect("/agency");
  return user;
}

/** ADMIN only — user management, settings, integrations. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    if (isAgency(user.role)) redirect("/agency");
    redirect("/funnel");
  }
  return user;
}

/**
 * An agency user together with their guaranteed-non-null agencyId. Every agency-side query
 * takes that id from here, never from a request parameter.
 */
export async function requireAgencyUser(): Promise<SessionUser & { agencyId: string }> {
  const user = await requireUser();
  if (!isAgency(user.role) || !user.agencyId) redirect("/funnel");
  return user as SessionUser & { agencyId: string };
}

/** Where a user belongs after logging in. */
export function landingPathFor(role: UserRole): string {
  return isAgency(role) ? "/agency" : "/funnel";
}

export async function recordActivity(params: {
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}) {
  await prisma.activityLog.create({
    data: {
      actorUserId: params.actorUserId ?? null,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      action: params.action,
      meta: (params.meta ?? undefined) as never,
      ip: params.ip ?? null,
    },
  });
}
