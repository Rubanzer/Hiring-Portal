import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getAgencyApplication } from "@/lib/tenancy";

export const runtime = "nodejs";

const schema = z.object({ fileId: z.string().uuid() });

/**
 * Attaches a resume to an application that already exists.
 *
 * This is what lets an agency submit without waiting for the upload. The submission goes
 * through immediately with no resume, the upload continues in the background, and the browser
 * calls this once the bytes have landed — so the wait stops being something a person sits
 * through and becomes something that finishes on its own.
 *
 * Scoped through lib/tenancy for agency users, so one agency can't attach a file to another's
 * application. Internal users can attach to anything, which is how you'd fix up a submission
 * whose upload failed on the agency's side.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

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

  // 404 rather than 403 across tenants, matching every other cross-agency read here.
  if (user.agencyId) {
    const application = await getAgencyApplication(user.agencyId, id);
    if (!application) return NextResponse.json({ error: "Not found." }, { status: 404 });
  } else {
    const exists = await prisma.application.count({ where: { id } });
    if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const file = await prisma.storedFile.findUnique({
    where: { id: parsed.data.fileId },
    select: { id: true, uploadedByUserId: true, uploadedAt: true },
  });

  // Only a file this user uploaded, and only one Drive has confirmed holds real bytes.
  // Without the second check an interrupted upload would attach as a valid-looking resume.
  if (!file || file.uploadedByUserId !== user.id) {
    return NextResponse.json({ error: "That resume wasn't found." }, { status: 404 });
  }
  if (!file.uploadedAt) {
    return NextResponse.json({ error: "That upload hasn't finished." }, { status: 400 });
  }

  await prisma.application.update({
    where: { id },
    data: { resumeFileId: file.id },
  });

  return NextResponse.json({ ok: true });
}
