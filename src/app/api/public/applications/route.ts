import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guardPublicRequest, readJson } from "@/lib/public-api";
import { createSubmission } from "@/lib/submissions";

export const runtime = "nodejs";

const schema = z.object({
  jobRoleId: z.string().uuid(),

  fullName: z.string().min(1).max(200),
  email: z.string().max(320).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  currentCompany: z.string().max(200).optional().nullable(),
  currentTitle: z.string().max(200).optional().nullable(),
  currentLocation: z.string().max(200).optional().nullable(),
  linkedinUrl: z.string().max(500).optional().nullable(),
  totalExperienceMonths: z.number().int().min(0).max(960).optional().nullable(),

  currentCtc: z.union([z.string().max(60), z.number()]).optional().nullable(),
  expectedCtc: z.union([z.string().max(60), z.number()]).optional().nullable(),
  noticePeriod: z.union([z.string().max(60), z.number()]).optional().nullable(),

  resumeFileId: z.string().uuid().optional().nullable(),

  /** Answers keyed by the question ids from GET /api/public/roles. */
  answers: z.record(z.string(), z.unknown()).optional(),
});

/**
 * An application from your careers page.
 *
 * This is a thin wrapper: `createSubmission` is the same function the agency form calls, so a
 * website applicant is deduplicated against agency submissions, screened against the same
 * questions, and lands in the same entry stage. That shared path is the point — it's what makes
 * "the same person is never counted twice" true across sources rather than per-source.
 *
 * One deliberate difference from the agency response: a duplicate is reported as success. The
 * agency portal tells a recruiter "someone already submitted this candidate" because that's a
 * commercial fact they need. Telling an anonymous caller the same thing turns this endpoint
 * into an oracle for "is this person in your pipeline" — feed it an email, read the answer. The
 * duplicate is still recorded in `duplicate_submissions` exactly as before, so you see it; the
 * caller just can't tell. Validation errors *are* reported, because those describe the request
 * rather than a person.
 */
export async function POST(request: Request) {
  const guard = guardPublicRequest(request, {
    name: "public-apply",
    max: 20,
    windowMs: 60 * 60_000,
  });
  if (!guard.ok) return guard.response;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some fields are missing or malformed.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Re-check the role is open. The id came from a public list, but a role can be paused between
  // the page loading and the form being submitted, and nothing stops a caller sending any id.
  const role = await prisma.jobRole.findUnique({
    where: { id: input.jobRoleId },
    select: { status: true },
  });
  if (!role || role.status !== "OPEN") {
    return NextResponse.json(
      { error: "That role isn't accepting applications." },
      { status: 404 },
    );
  }

  if (input.resumeFileId) {
    const file = await prisma.storedFile.findUnique({
      where: { id: input.resumeFileId },
      select: { uploadedByUserId: true, uploadedAt: true },
    });

    // `uploadedByUserId !== null` means this file was uploaded through the authenticated agency
    // path. Accepting it here would let a public caller attach their application to an agency's
    // resume — the same class of hole the server-derived Drive id closes on the upload side.
    if (!file || file.uploadedByUserId !== null) {
      return NextResponse.json({ error: "That resume wasn't found." }, { status: 400 });
    }
    if (!file.uploadedAt) {
      return NextResponse.json(
        { error: "The resume upload hasn't finished. Call /api/public/uploads/complete first." },
        { status: 400 },
      );
    }
  }

  const result = await createSubmission({
    ...input,
    source: "WEBSITE",
    // A website application belongs to no agency and to no portal user. The database enforces
    // the first of those with a CHECK constraint.
    agencyId: null,
    submittedByUserId: null,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  // "created" and "duplicate" are intentionally indistinguishable here — see above.
  return NextResponse.json({ status: "received" }, { status: 201 });
}
