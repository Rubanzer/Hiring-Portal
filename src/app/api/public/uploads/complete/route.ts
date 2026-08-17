import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guardPublicRequest, readJson } from "@/lib/public-api";
import { confirmUpload } from "@/lib/storage";

export const runtime = "nodejs";

const schema = z.object({ fileId: z.string().uuid() });

/**
 * Confirms the applicant's upload actually landed in Drive.
 *
 * The database row is created before the bytes are sent, so without this step an abandoned
 * upload would produce an application pointing at an empty file that looks entirely valid —
 * you'd find out when you opened the resume in the review queue. Drive is asked directly
 * rather than trusting the browser's claim about what it sent.
 *
 * The agency version restricts this to the uploading user. A public upload has no user, so the
 * fileId is the capability: it's a v4 UUID returned only to the caller that created it. The
 * worst a guessed id could do is stamp `uploadedAt` on a record that already has real bytes in
 * Drive — the confirmation reads Drive, so it can't invent a size or attach anything.
 */
export async function POST(request: Request) {
  const guard = guardPublicRequest(request, {
    name: "public-upload-complete",
    max: 20,
    windowMs: 60 * 60_000,
  });
  if (!guard.ok) return guard.response;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const file = await prisma.storedFile.findUnique({ where: { id: parsed.data.fileId } });
  // 404 rather than 403 for a file that exists but belongs to a signed-in user's upload: the
  // public caller should not be able to tell the two apart.
  if (!file || file.uploadedByUserId !== null) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await confirmUpload(file.driveFileId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  await prisma.storedFile.update({
    where: { id: file.id },
    // The size Drive reports, not the one the browser claimed.
    data: { uploadedAt: new Date(), sizeBytes: result.sizeBytes },
  });

  return NextResponse.json({ ok: true, sizeBytes: result.sizeBytes });
}
