import { NextResponse } from "next/server";
import { authorizeFile, privateFileHeaders } from "@/lib/file-access";
import { openOriginalStream, StorageNotConfiguredError } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the original resume.
 *
 * The body is a stream, never a Buffer. Vercel caps a function's *response* body at 4.5 MB but
 * exempts streamed responses, so buffering here would break every resume above that size —
 * and only those, which is the kind of bug that passes every test with a small fixture and
 * then fails on the first real scanned CV. tests/storage.test.ts asserts the stream directly
 * for that reason.
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
      { error: "That upload never finished, so there's nothing to download." },
      { status: 409 },
    );
  }

  try {
    const body = await openOriginalStream(file.driveFileId);
    return new Response(body, {
      headers: privateFileHeaders({
        mimeType: file.mimeType,
        fileName: file.originalName,
        disposition: "attachment",
      }),
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
