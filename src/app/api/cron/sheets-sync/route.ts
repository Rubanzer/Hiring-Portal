import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { importAllSources, verifySharedSecret } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled safety-net pull.
 *
 * The webhook handles the common case; this exists because Apps Script triggers get disabled
 * silently (quota, permission changes, someone copying the sheet) and nobody notices until a
 * week of leads has gone missing. Re-reading rows already imported is free — the rowHash
 * ledger makes it a no-op.
 *
 * Vercel Cron sends its secret in the Authorization header; a manual curl can use
 * ?secret= instead.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret");

  if (!verifySharedSecret(provided, env().CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await importAllSources("CRON");

  const totals = results.reduce(
    (acc, r) => ({
      created: acc.created + r.outcome.created,
      duplicates: acc.duplicates + r.outcome.duplicates,
      needsReview: acc.needsReview + r.outcome.needsReview,
      errors: acc.errors + r.outcome.errors,
    }),
    { created: 0, duplicates: 0, needsReview: 0, errors: 0 },
  );

  return NextResponse.json({ ok: true, sources: results.length, totals, results });
}
