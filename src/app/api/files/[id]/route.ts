import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isInternal, isAgency } from "@/lib/auth";
import { agencyCanAccessFile } from "@/lib/tenancy";
import { createDownloadUrl, StorageNotConfiguredError } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * The only route to a resume.
 *
 * The bucket is private; this endpoint authorises the request and then redirects to a signed
 * URL that lives for 60 seconds. An agency may only fetch files attached to its own
 * applications, and an unauthorised id returns 404 rather than 403 — a 403 would confirm the
 * file exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (isAgency(user.role)) {
    if (!user.agencyId || !(await agencyCanAccessFile(user.agencyId, id))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  } else if (!isInternal(user.role)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = await createDownloadUrl({
      storageKey: file.storageKey,
      fileName: file.originalName,
    });
    return NextResponse.redirect(url, 302);
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
