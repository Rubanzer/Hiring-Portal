import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeFile } from "@/lib/file-access";
import { ensurePreview, StorageNotConfiguredError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reports whether a resume is ready to display, kicking off the Word-to-PDF conversion if it
 * hasn't started.
 *
 * Separate from the preview route so the viewer can poll cheaply. Polling the preview itself
 * would mean opening — and immediately discarding — a Drive download stream on every tick,
 * because Next answers HEAD by running the GET handler and dropping the body.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await authorizeFile(id);
  if (!access.ok) {
    return NextResponse.json(
      { status: "error", error: access.status === 401 ? "Not signed in." : "Not found." },
      { status: access.status },
    );
  }

  const { file } = access;

  if (!file.uploadedAt) {
    return NextResponse.json({
      status: "missing",
      error: "This upload never finished, so there's no file to show.",
    });
  }

  try {
    const target = await ensurePreview(file, {
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

    if (target.kind === "ready") return NextResponse.json({ status: "ready" });
    if (target.kind === "pending") return NextResponse.json({ status: "pending" });

    return NextResponse.json({
      status: "failed",
      error: "This file couldn't be converted for preview. You can still download the original.",
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ status: "failed", error: error.message }, { status: 503 });
    }
    throw error;
  }
}
