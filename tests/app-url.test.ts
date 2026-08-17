import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unused";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";

/**
 * Where invite links point.
 *
 * This was the bug: with APP_URL unset the portal built every invitation against
 * localhost, the app itself worked perfectly, and nothing surfaced the problem — the first
 * symptom was an agency reporting that their link opened nothing. So the resolution order is
 * pinned down here rather than left to be re-derived.
 */
async function load(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of ["APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  return import("../src/lib/env");
}

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

describe("appUrl", () => {
  it("uses APP_URL when it's a real address", async () => {
    const { appUrl } = await load({ APP_URL: "https://hiring.example.com" });
    expect(appUrl()).toBe("https://hiring.example.com");
  });

  it("falls back to the Vercel production domain when APP_URL is unset", async () => {
    // The whole point: a deployment nobody configured still produces working invite links.
    const { appUrl } = await load({ VERCEL_PROJECT_PRODUCTION_URL: "hiring-portal.vercel.app" });
    expect(appUrl()).toBe("https://hiring-portal.vercel.app");
  });

  it("prefers an explicit APP_URL over the platform's guess", async () => {
    const { appUrl } = await load({
      APP_URL: "https://careers.example.com",
      VERCEL_PROJECT_PRODUCTION_URL: "hiring-portal.vercel.app",
    });
    expect(appUrl()).toBe("https://careers.example.com");
  });

  it("recovers from a hostname with no scheme, the classic mistake", async () => {
    const { appUrl, appUrlIsMisconfigured } = await load({
      APP_URL: "hiring-portal.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "hiring-portal.vercel.app",
    });

    // Not a URL, so it's ignored rather than producing "hiring-portal.vercel.app/set-password".
    expect(appUrl()).toBe("https://hiring-portal.vercel.app");
    expect(appUrlIsMisconfigured()).toBe(true);
  });

  it("rejects a non-http scheme", async () => {
    const { appUrl, appUrlIsMisconfigured } = await load({ APP_URL: "javascript:alert(1)" });
    expect(appUrl()).toBe("http://localhost:3000");
    expect(appUrlIsMisconfigured()).toBe(true);
  });

  it("falls back to localhost with nothing set at all", async () => {
    const { appUrl, appUrlIsMisconfigured } = await load({});
    expect(appUrl()).toBe("http://localhost:3000");
    // Unset is not a misconfiguration — it's the normal state locally.
    expect(appUrlIsMisconfigured()).toBe(false);
  });

  it("strips a trailing slash so links don't come out doubled", async () => {
    const { appUrl } = await load({ APP_URL: "https://hiring.example.com/" });
    // Otherwise: https://hiring.example.com//set-password?token=…
    expect(appUrl()).toBe("https://hiring.example.com");
    expect(`${appUrl()}/set-password`).toBe("https://hiring.example.com/set-password");
  });

  it("tolerates a scheme pasted into the Vercel variable", async () => {
    // Vercel supplies a bare hostname, but people paste the full URL in by hand.
    const { appUrl } = await load({ VERCEL_PROJECT_PRODUCTION_URL: "https://hiring.example.com/" });
    expect(appUrl()).toBe("https://hiring.example.com");
  });
});
