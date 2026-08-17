import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
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
 * Opens a Drive resumable upload session for a resume.
 *
 * The browser uploads straight to Google using the returned URI, so the file never passes
 * through this function — which is what keeps Vercel's 4.5 MB request body cap out of the
 * picture and lets resumes go up to 25 MB.
 *
 * The Drive file id is created here and stored server-side. The client only ever learns our
 * own record id, so it can't attach a submission to a file it doesn't own.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!checkRateLimit(`upload:${user.id}`, 120, 60 * 60_000).allowed) {
    return NextResponse.json(
      { error: "Too many uploads in the last hour. Try again shortly." },
      { status: 429 },
    );
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      {
        error:
          "Resume storage isn't set up on this deployment yet. Ask the hiring team to connect Google Drive.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

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
        uploadedByUserId: user.id,
        // previewStatus defaults to NOT_STARTED. PDFs never consult it; Word files are
        // converted lazily on first preview.
      },
    });

    return NextResponse.json({ fileId: file.id, uploadUrl });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof DriveFolderUnreachableError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
