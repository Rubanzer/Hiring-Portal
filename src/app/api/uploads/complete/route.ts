import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { confirmUpload } from "@/lib/storage";

export const runtime = "nodejs";

const schema = z.object({ fileId: z.string().uuid() });

/**
 * Confirms that the browser's upload actually landed in Drive.
 *
 * The database row is created before the upload starts, so without this step an abandoned or
 * failed upload would leave an application attached to an empty file that looks entirely
 * valid — you'd only find out when you opened the resume. Drive is the source of truth for
 * whether bytes exist, so we ask it rather than trusting the browser's word.
 *
 * Only the uploader can confirm their own file, so one agency can't mark another's record as
 * complete.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const file = await prisma.storedFile.findUnique({ where: { id: parsed.data.fileId } });
  if (!file || file.uploadedByUserId !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await confirmUpload(file.driveFileId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  await prisma.storedFile.update({
    where: { id: file.id },
    // Record the size Drive reports rather than the one the browser claimed.
    data: { uploadedAt: new Date(), sizeBytes: result.sizeBytes },
  });

  return NextResponse.json({ ok: true, sizeBytes: result.sizeBytes });
}
