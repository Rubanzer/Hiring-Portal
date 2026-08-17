import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeFile, privateFileHeaders } from "@/lib/file-access";
import {
  ensurePreview,
  openOriginalStream,
  StorageNotConfiguredError,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Converting a Word file is a few Drive round-trips; the default 10s isn't enough headroom.
export const maxDuration = 60;

/**
 * Streams a browser-displayable version of a resume, so it can be read inside the portal
 * instead of in Drive.
 *
 * PDFs stream as-is. DOC and DOCX are converted to PDF by Drive once, on first view, and the
 * result is cached on the file record — so the first open of a Word CV takes a few seconds and
 * every open after it is immediate.
 *
 * Like the download route, the body is a stream: streamed responses are exempt from Vercel's
 * 4.5 MB response cap, buffered ones are not.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await authorizeFile(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? "Not signed in." : "Not found." },
      { status: access.status },
    );
  }

  const { file } = access;

  if (!file.uploadedAt) {
    return NextResponse.json(
      { status: "failed", error: "That upload never finished." },
      { status: 409 },
    );
  }

  try {
    const target = await ensurePreview(file, {
      /**
       * Atomic claim: the update only matches while the row is still NOT_STARTED, so of two
       * simultaneous viewers exactly one gets `true` and starts the conversion. The other is
       * told to retry rather than converting the same file twice.
       */
      claimPending: async (fileId) => {
        const claimed = await prisma.storedFile.updateMany({
          where: { id: fileId, previewStatus: "NOT_STARTED" },
          data: { previewStatus: "PENDING" },
        });
        return claimed.count === 1;
      },
      markReady: async (fileId, previewFileId) => {
        await prisma.storedFile.update({
          where: { id: fileId },
          data: { previewFileId, previewStatus: "READY", previewError: null },
        });
      },
      markFailed: async (fileId, reason) => {
        await prisma.storedFile.update({
          where: { id: fileId },
          data: { previewStatus: "FAILED", previewError: reason.slice(0, 500) },
        });
      },
    });

    if (target.kind === "pending") {
      // 202 rather than an error: the viewer polls on this and shows "preparing preview".
      return NextResponse.json({ status: "pending" }, { status: 202 });
    }

    if (target.kind === "failed") {
      return NextResponse.json(
        {
          status: "failed",
          error:
            "This file couldn't be converted for preview. You can still download the original.",
        },
        { status: 422 },
      );
    }

    const body = await openOriginalStream(target.driveFileId);
    return new Response(body, {
      headers: privateFileHeaders({
        mimeType: target.mimeType,
        fileName: file.originalName,
        disposition: "inline",
      }),
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ status: "failed", error: error.message }, { status: 503 });
    }
    throw error;
  }
}
