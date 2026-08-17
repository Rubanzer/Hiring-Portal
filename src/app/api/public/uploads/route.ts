import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guardPublicRequest, readJson } from "@/lib/public-api";
import { isStorageConfigured } from "@/lib/env";
import {
  beginUpload,
  DriveFolderUnreachableError,
  StorageNotConfiguredError,
  validateResumeUpload,
} from "@/lib/storage";

export const runtime = "nodejs";

const schema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

/**
 * Opens a Drive resumable upload session for an applicant's resume.
 *
 * Same mechanism as the agency upload: the browser PUTs the bytes straight to Google, so the
 * file never crosses this function and Vercel's 4.5 MB request cap never applies. That's what
 * lets a careers-page applicant attach a 25 MB scanned CV.
 *
 * The rate limit here is tighter than the agency one. An agency recruiter legitimately uploads
 * dozens of CVs in a sitting; a job applicant uploads one, maybe two if the first attempt
 * failed. Anything beyond a handful an hour from one address is not a person applying for a
 * job, and this endpoint writes into your Drive folder.
 */
export async function POST(request: Request) {
  const guard = guardPublicRequest(request, {
    name: "public-upload",
    max: 10,
    windowMs: 60 * 60_000,
  });
  if (!guard.ok) return guard.response;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Resume uploads aren't available on this deployment yet." },
      { status: 503 },
    );
  }

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  // Type and size are checked before Drive is touched, so a rejected file costs one round trip
  // rather than an abandoned Drive object.
  const validationError = validateResumeUpload(parsed.data);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const { driveFileId, uploadUrl } = await beginUpload({
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
    });

    const file = await prisma.storedFile.create({
      data: {
        driveFileId,
        originalName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
        // No user: an applicant has no account. The returned fileId is the only handle to this
        // record and is never guessable, so it is itself the capability to finish the upload.
        uploadedByUserId: null,
      },
    });

    return NextResponse.json({ fileId: file.id, uploadUrl });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof DriveFolderUnreachableError) {
      // Deliberately not echoed to the public caller — it names your folder id and service
      // account. The applicant gets a generic failure; you get the detail in the logs.
      console.error("Public upload failed:", error.message);
      return NextResponse.json(
        { error: "Resume uploads are temporarily unavailable." },
        { status: 502 },
      );
    }
    throw error;
  }
}
