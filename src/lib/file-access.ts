import "server-only";
import { prisma } from "./db";
import { getSessionUser, isAgency, isInternal } from "./auth";
import { agencyCanAccessFile } from "./tenancy";

/**
 * The authorisation gate in front of every resume, shared by the download and preview routes.
 *
 * One implementation on purpose: two copies of this check is how a preview endpoint quietly
 * ends up more permissive than the download it previews.
 */
export type FileAccess =
  | { ok: true; file: NonNullable<Awaited<ReturnType<typeof loadFile>>> }
  | { ok: false; status: 401 | 404 };

function loadFile(id: string) {
  return prisma.storedFile.findUnique({ where: { id } });
}

/**
 * Resolves a file for the current user.
 *
 * An id the caller isn't entitled to returns 404, never 403 — a 403 confirms the file exists,
 * which turns the id space into something worth probing.
 */
export async function authorizeFile(id: string): Promise<FileAccess> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };

  const file = await loadFile(id);
  if (!file) return { ok: false, status: 404 };

  if (isAgency(user.role)) {
    if (!user.agencyId || !(await agencyCanAccessFile(user.agencyId, id))) {
      return { ok: false, status: 404 };
    }
    return { ok: true, file };
  }

  if (!isInternal(user.role)) return { ok: false, status: 404 };
  return { ok: true, file };
}

/** Headers every resume response carries. Resumes are personal data; nothing caches them. */
export function privateFileHeaders(params: {
  mimeType: string;
  fileName: string;
  disposition: "inline" | "attachment";
}): HeadersInit {
  return {
    "Content-Type": params.mimeType,
    // Quotes stripped so a filename can't break out of the header value.
    "Content-Disposition": `${params.disposition}; filename="${params.fileName.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}
