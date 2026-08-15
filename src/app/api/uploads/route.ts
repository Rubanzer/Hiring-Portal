import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isStorageConfigured } from "@/lib/env";
import {
  buildStorageKey,
  createUploadUrl,
  validateResumeUpload,
} from "@/lib/storage";

export const runtime = "nodejs";

const schema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

/**
 * Hands out a short-lived signed PUT URL for a resume.
 *
 * The file record is created up front so the client only ever sends us an id, never a
 * storage path — an agency can't point an application at somebody else's object by guessing
 * a key. Records whose upload never completes are harmless orphans; a periodic cleanup can
 * drop files with no application after a day.
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
          "Resume storage isn't configured on this deployment. Ask the hiring team to set it up.",
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

  const storageKey = buildStorageKey(parsed.data.fileName, parsed.data.mimeType);

  const file = await prisma.storedFile.create({
    data: {
      storageKey,
      originalName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      uploadedByUserId: user.id,
    },
  });

  const uploadUrl = await createUploadUrl({
    storageKey,
    mimeType: parsed.data.mimeType,
  });

  return NextResponse.json({ fileId: file.id, uploadUrl });
}
