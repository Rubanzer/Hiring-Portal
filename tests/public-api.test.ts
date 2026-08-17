import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";

const KEY = "careers-key-0123456789abcdef";

/**
 * The /api/public routes are the only part of the portal reachable without a session, so the
 * guard in front of them is the whole perimeter. These cover its branches directly; the routes
 * themselves are exercised end-to-end against a real database in `npm run verify`.
 *
 * `env()` caches on first call and the rate limiter holds module-level state, so each case
 * re-imports the module with the environment it needs rather than sharing one instance.
 */
async function load(apiKey: string | undefined) {
  vi.resetModules();
  if (apiKey === undefined) delete process.env.CAREERS_API_KEY;
  else process.env.CAREERS_API_KEY = apiKey;
  return import("../src/lib/public-api");
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://portal.example.com/api/public/roles", { headers });
}

const LIMIT = { name: "test", max: 3, windowMs: 60_000 };

afterEach(() => {
  delete process.env.CAREERS_API_KEY;
});

describe("guardPublicRequest", () => {
  it("refuses everything when no key is configured", async () => {
    const { guardPublicRequest } = await load(undefined);

    const result = guardPublicRequest(req({ "x-api-key": "anything" }), LIMIT);

    // Closed by default. An unconfigured deployment must not be an open one — otherwise
    // forgetting the variable silently publishes a write endpoint into your Drive folder.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("rejects a missing key", async () => {
    const { guardPublicRequest } = await load(KEY);

    const result = guardPublicRequest(req(), LIMIT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a wrong key", async () => {
    const { guardPublicRequest } = await load(KEY);

    const result = guardPublicRequest(req({ "x-api-key": "careers-key-WRONG0123456789" }), LIMIT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a key that is a prefix of the real one", async () => {
    const { guardPublicRequest } = await load(KEY);

    // Length is checked before the timing-safe compare, which would otherwise throw.
    const result = guardPublicRequest(req({ "x-api-key": KEY.slice(0, 10) }), LIMIT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("accepts the right key", async () => {
    const { guardPublicRequest } = await load(KEY);

    expect(guardPublicRequest(req({ "x-api-key": KEY }), LIMIT).ok).toBe(true);
  });
});

describe("rate limiting", () => {
  beforeEach(() => vi.resetModules());

  it("cuts off after the limit and says when to retry", async () => {
    const { guardPublicRequest } = await load(KEY);
    const headers = { "x-api-key": KEY, "x-forwarded-for": "203.0.113.9" };

    for (let i = 0; i < LIMIT.max; i++) {
      expect(guardPublicRequest(req(headers), LIMIT).ok, `request ${i + 1}`).toBe(true);
    }

    const blocked = guardPublicRequest(req(headers), LIMIT);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get("Retry-After")).toBeTruthy();
    }
  });

  it("counts each address separately", async () => {
    const { guardPublicRequest } = await load(KEY);

    for (let i = 0; i < LIMIT.max; i++) {
      guardPublicRequest(req({ "x-api-key": KEY, "x-forwarded-for": "203.0.113.1" }), LIMIT);
    }

    // One applicant exhausting their allowance must not lock out everyone else.
    const other = guardPublicRequest(
      req({ "x-api-key": KEY, "x-forwarded-for": "203.0.113.2" }),
      LIMIT,
    );
    expect(other.ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop from x-forwarded-for", async () => {
    const { clientIp } = await load(KEY);

    // Vercel appends proxies to the right, so the client is the leftmost entry.
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.7, 10.0.0.1, 10.0.0.2" }))).toBe(
      "198.51.100.7",
    );
  });

  it("falls back to x-real-ip, then to a constant", async () => {
    const { clientIp } = await load(KEY);

    expect(clientIp(req({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(req())).toBe("unknown");
  });
});
