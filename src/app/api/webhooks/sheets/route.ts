import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { importSheetSource, verifySharedSecret } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  spreadsheetId: z.string().min(10),
  sheetName: z.string().min(1),
});

/**
 * Apps Script push endpoint: called the moment a row lands in the leads sheet.
 *
 * The payload only identifies WHICH sheet changed — the portal then reads the sheet itself
 * with its own service-account credentials. That way a leaked webhook secret can trigger an
 * import but can never inject a fabricated candidate.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-portal-secret");
  if (!verifySharedSecret(secret, env().SHEETS_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit("sheets-webhook", 120, 60_000).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const source = await prisma.sheetSource.findUnique({
    where: {
      spreadsheetId_sheetName: {
        spreadsheetId: parsed.data.spreadsheetId,
        sheetName: parsed.data.sheetName,
      },
    },
  });

  if (!source) {
    // Not an error the sheet can fix — tell the truth so the Apps Script log is useful.
    return NextResponse.json(
      { error: "That spreadsheet and tab are not configured in the portal." },
      { status: 404 },
    );
  }

  const outcome = await importSheetSource(source.id, "WEBHOOK");
  return NextResponse.json({ ok: true, ...outcome });
}
