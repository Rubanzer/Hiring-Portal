"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import {
  createSession,
  destroySession,
  landingPathFor,
  recordActivity,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/normalize";

const loginSchema = z.object({
  email: z.string().min(1, "Enter your email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginState = { error?: string };

/**
 * Credential login.
 *
 * Every failure path returns the same message and takes a similar amount of work, so the form
 * can't be used to discover which email addresses have accounts.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter your email and password." };
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) return { error: "Email or password is incorrect." };

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null;

  // Two buckets: one per account (stops a targeted guess), one per IP (stops a sweep).
  const perAccount = checkRateLimit(`login:email:${email}`, 8, 15 * 60_000);
  const perIp = checkRateLimit(`login:ip:${ip ?? "unknown"}`, 30, 15 * 60_000);
  if (!perAccount.allowed || !perIp.allowed) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { agency: true },
  });

  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash);

  if (!user || !passwordOk) {
    return { error: "Email or password is incorrect." };
  }
  if (!user.isActive) {
    return { error: "This account has been deactivated. Contact your administrator." };
  }
  if (user.agency && user.agency.status === "PAUSED") {
    return { error: "Your agency's access is currently paused. Contact your administrator." };
  }

  await createSession(user.id, { ip, userAgent: headerList.get("user-agent") });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await recordActivity({
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "login",
    ip,
  });

  redirect(landingPathFor(user.role));
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
