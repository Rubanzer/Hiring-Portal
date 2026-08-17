import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";
import { checkRateLimit } from "./rate-limit";
import { verifySharedSecret } from "./secrets";

/**
 * The guard every /api/public route runs first.
 *
 * These are the only endpoints in the portal reachable without a session, so they are the only
 * ones an outsider can reach at all. Two rules apply to all of them:
 *
 *   1. A valid X-API-Key, matching CAREERS_API_KEY. If the key isn't configured the routes
 *      refuse everything — closed by default, rather than open until someone remembers to
 *      protect them. Your careers site calls these from its own backend, so the key stays
 *      server-side and never reaches a visitor's browser.
 *   2. A per-IP rate limit, because a valid key plus a scripted loop would otherwise fill your
 *      Drive folder or your funnel.
 */

/** Vercel puts the real client address first in x-forwarded-for. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export type Guarded = { ok: true } | { ok: false; response: NextResponse };

export function guardPublicRequest(
  request: Request,
  limit: { name: string; max: number; windowMs: number },
): Guarded {
  const configured = env().CAREERS_API_KEY;
  if (!configured) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This portal isn't accepting website applications yet." },
        { status: 503 },
      ),
    };
  }

  if (!verifySharedSecret(request.headers.get("x-api-key"), configured)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const result = checkRateLimit(`${limit.name}:${clientIp(request)}`, limit.max, limit.windowMs);
  if (!result.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)) },
        },
      ),
    };
  }

  return { ok: true };
}

/** Parses a JSON body, returning null rather than throwing on malformed input. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
