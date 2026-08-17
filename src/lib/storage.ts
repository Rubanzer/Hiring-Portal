import "server-only";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { env, isStorageConfigured } from "./env";
import { googleAccessToken, googleJwt, SCOPES } from "./google-auth";

/**
 * Resume storage on Google Drive.
 *
 * Two platform constraints shape everything here, and both come from the same place: Vercel
 * caps function request *and* response bodies at 4.5 MB, and that cap cannot be raised.
 *
 *   Upload   — the server opens a Drive resumable session and hands the session URI to the
 *              browser, which PUTs the bytes straight to Google. Nothing passes through the
 *              function, so the request cap never applies.
 *   Download — the route streams bytes from Drive to the browser. Streamed responses are
 *              exempt from the response cap; a buffered one is not. That is why every read
 *              path in this file returns a stream and never a Buffer, and why the 25 MB
 *              limit below is achievable at all.
 *
 * Files stay private. They are never given an "anyone with the link" permission, so the only
 * way to a resume is through /api/files/[id], which authorises the request first.
 */

export const ALLOWED_RESUME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/**
 * 25 MB. Scanned CVs regularly pass 10 MB, and neither direction buffers a whole file, so the
 * ceiling is a product decision rather than a platform one.
 */
export const MAX_RESUME_BYTES = 25 * 1024 * 1024;

/** Formats browsers render natively in an iframe; everything else needs converting first. */
const BROWSER_RENDERABLE = new Set(["application/pdf"]);

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Resume storage is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY " +
        "and GOOGLE_DRIVE_FOLDER_ID, and add the service account as a member of the Shared Drive.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

/**
 * Wraps the errors Google returns for the two mistakes everyone makes during setup, because
 * a bare "File not found: 1a2b3c" gives no clue which of them happened.
 */
export class DriveFolderUnreachableError extends Error {
  constructor(cause: string) {
    super(
      "The Drive folder isn't reachable. Check GOOGLE_DRIVE_FOLDER_ID is the folder's id (not " +
        "its name or full URL), and that the service account is a member of that Shared Drive " +
        `with at least Content manager access. Google said: ${cause}`,
    );
    this.name = "DriveFolderUnreachableError";
  }
}

/**
 * The Drive calls this module makes, as an interface.
 *
 * Injectable so the upload, confirm and preview logic can be tested against a stub — the
 * behaviour worth testing (that ids come from Drive and never from the caller, that a second
 * concurrent preview doesn't convert twice) shouldn't require network access to verify.
 */
export type DriveClient = {
  createFile(params: {
    name: string;
    mimeType: string;
    parentId: string;
  }): Promise<{ id: string }>;
  getFile(fileId: string): Promise<{ id: string; size: number; mimeType: string } | null>;
  openResumableSession(params: { fileId: string; mimeType: string }): Promise<string>;
  downloadStream(fileId: string): Promise<NodeJS.ReadableStream>;
  copyAsGoogleDoc(params: { fileId: string; name: string }): Promise<{ id: string }>;
  exportPdfStream(fileId: string): Promise<NodeJS.ReadableStream>;
  uploadStream(params: {
    name: string;
    mimeType: string;
    parentId: string;
    body: NodeJS.ReadableStream;
  }): Promise<{ id: string }>;
  deleteFile(fileId: string): Promise<void>;
};

let injected: DriveClient | null = null;

/** Test seam. Pass null to restore the real client. */
export function setDriveClient(client: DriveClient | null) {
  injected = client;
}

function api(): drive_v3.Drive {
  if (!isStorageConfigured()) throw new StorageNotConfiguredError();
  return google.drive({
    version: "v3",
    auth: googleJwt(SCOPES.drive, "Resume storage"),
  });
}

/** Every Drive call needs these two flags, or it silently can't see Shared Drive content. */
const SHARED_DRIVE = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: number; status?: number })?.code;
  const status = (error as { status?: number })?.status;
  return code === 404 || status === 404 || code === 403 || status === 403;
}

function realDriveClient(): DriveClient {
  return {
    async createFile({ name, mimeType, parentId }) {
      try {
        const res = await api().files.create({
          requestBody: { name, mimeType, parents: [parentId] },
          fields: "id",
          supportsAllDrives: true,
        });
        if (!res.data.id) throw new Error("Drive did not return a file id.");
        return { id: res.data.id };
      } catch (error) {
        if (isNotFound(error)) {
          throw new DriveFolderUnreachableError(
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }
    },

    async getFile(fileId) {
      try {
        const res = await api().files.get({
          fileId,
          fields: "id, size, mimeType",
          ...SHARED_DRIVE,
        });
        return {
          id: res.data.id!,
          size: Number.parseInt(res.data.size ?? "0", 10),
          mimeType: res.data.mimeType ?? "application/octet-stream",
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /**
     * Opens a resumable session against an *existing* file and returns the session URI.
     *
     * Done with fetch rather than the googleapis client because we need the raw `Location`
     * response header, which the client doesn't surface. Crucially this call happens
     * server-side: a browser doing it couldn't read that header cross-origin.
     */
    async openResumableSession({ fileId, mimeType }) {
      const token = await googleAccessToken(SCOPES.drive, "Resume storage");
      const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}` +
          `?uploadType=resumable&supportsAllDrives=true`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mimeType,
          },
          body: JSON.stringify({}),
        },
      );

      const sessionUri = response.headers.get("location");
      if (!response.ok || !sessionUri) {
        throw new Error(
          `Drive refused to start the upload (${response.status}): ${await response.text()}`,
        );
      }
      return sessionUri;
    },

    async downloadStream(fileId) {
      const res = await api().files.get(
        { fileId, alt: "media", ...SHARED_DRIVE },
        { responseType: "stream" },
      );
      return res.data as unknown as NodeJS.ReadableStream;
    },

    async copyAsGoogleDoc({ fileId, name }) {
      const res = await api().files.copy({
        fileId,
        requestBody: { name, mimeType: GOOGLE_DOC_MIME },
        fields: "id",
        supportsAllDrives: true,
      });
      if (!res.data.id) throw new Error("Drive did not return a converted file id.");
      return { id: res.data.id };
    },

    async exportPdfStream(fileId) {
      const res = await api().files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "stream" },
      );
      return res.data as unknown as NodeJS.ReadableStream;
    },

    async uploadStream({ name, mimeType, parentId, body }) {
      const res = await api().files.create({
        requestBody: { name, mimeType, parents: [parentId] },
        media: { mimeType, body },
        fields: "id",
        supportsAllDrives: true,
      });
      if (!res.data.id) throw new Error("Drive did not return a file id.");
      return { id: res.data.id };
    },

    async deleteFile(fileId) {
      await api().files.delete({ fileId, supportsAllDrives: true });
    },
  };
}

export function drive(): DriveClient {
  return injected ?? realDriveClient();
}

function folderId(): string {
  if (!isStorageConfigured()) throw new StorageNotConfiguredError();
  return env().GOOGLE_DRIVE_FOLDER_ID!;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Checked before a resumable session is handed out. */
export function validateResumeUpload(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): string | null {
  if (!ALLOWED_RESUME_TYPES[params.mimeType]) {
    return "Resumes must be a PDF, DOC or DOCX file.";
  }
  if (params.sizeBytes <= 0) return "The file appears to be empty.";
  if (params.sizeBytes > MAX_RESUME_BYTES) {
    return `Resumes must be under ${MAX_RESUME_BYTES / (1024 * 1024)} MB.`;
  }
  if (params.fileName.length > 255) return "That filename is too long.";
  return null;
}

/**
 * Magic-byte check. Extensions and Content-Type headers are attacker-controlled; the first
 * few bytes of the file are not.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // %PDF
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";

  // PK.. — DOCX (and every other zip container)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  // D0 CF 11 E0 — legacy OLE compound file (.doc)
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return "application/msword";
  }

  return null;
}

/** Whether a stored file needs converting before a browser can display it inline. */
export function needsPreviewConversion(mimeType: string): boolean {
  return !BROWSER_RENDERABLE.has(mimeType);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Creates the Drive file and opens a resumable session for the browser to upload into.
 *
 * The file is created empty first so that Drive — not the client — decides its id. If the
 * browser reported an id after uploading, an agency could attach a record to somebody else's
 * resume simply by sending a different id back.
 */
export async function beginUpload(params: {
  fileName: string;
  mimeType: string;
}): Promise<{ driveFileId: string; uploadUrl: string }> {
  const client = drive();

  const created = await client.createFile({
    // The original filename is kept as-is so the Drive folder stays browsable by a human;
    // uniqueness comes from the Drive id, not the name.
    name: params.fileName,
    mimeType: params.mimeType,
    parentId: folderId(),
  });

  const uploadUrl = await client.openResumableSession({
    fileId: created.id,
    mimeType: params.mimeType,
  });

  return { driveFileId: created.id, uploadUrl };
}

/**
 * Asks Drive whether the bytes actually arrived.
 *
 * The database row is created before the browser uploads, so without this an abandoned upload
 * would leave an application pointing at an empty file that looks perfectly valid.
 */
export async function confirmUpload(
  driveFileId: string,
): Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }> {
  const file = await drive().getFile(driveFileId);
  if (!file) return { ok: false, reason: "Drive can't find that file." };
  if (file.size <= 0) return { ok: false, reason: "The upload didn't complete." };
  if (file.size > MAX_RESUME_BYTES) {
    return {
      ok: false,
      reason: `The file is larger than the ${MAX_RESUME_BYTES / (1024 * 1024)} MB limit.`,
    };
  }
  return { ok: true, sizeBytes: file.size };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Converts a Node stream to a web ReadableStream for a Response body.
 *
 * Deliberately a stream the whole way. Collecting into a Buffer here would cap every download
 * at Vercel's 4.5 MB response limit, and it would fail only for larger files — invisible in
 * testing with a small fixture, broken for exactly the scanned CVs this feature exists for.
 */
export function toWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(nodeStream)) as ReadableStream<Uint8Array>;
}

/** Streams the original file, whatever its format. Used for download. */
export async function openOriginalStream(
  driveFileId: string,
): Promise<ReadableStream<Uint8Array>> {
  return toWebStream(await drive().downloadStream(driveFileId));
}

export type PreviewTarget =
  | { kind: "ready"; driveFileId: string; mimeType: string }
  | { kind: "pending" }
  | { kind: "failed"; reason: string };

/**
 * Resolves what the viewer should display, converting Word files to PDF the first time and
 * caching the result.
 *
 * `claimPending` is how two people opening the same CV at once don't both start a conversion:
 * it must atomically flip the record to PENDING and report whether this caller won the race.
 * The loser gets `pending` and the UI retries.
 */
export async function ensurePreview(
  file: {
    id: string;
    driveFileId: string;
    originalName: string;
    mimeType: string;
    previewFileId: string | null;
    previewStatus: string;
    previewError: string | null;
  },
  hooks: {
    claimPending: (fileId: string) => Promise<boolean>;
    markReady: (fileId: string, previewFileId: string) => Promise<void>;
    markFailed: (fileId: string, reason: string) => Promise<void>;
  },
): Promise<PreviewTarget> {
  if (!needsPreviewConversion(file.mimeType)) {
    return { kind: "ready", driveFileId: file.driveFileId, mimeType: file.mimeType };
  }

  if (file.previewStatus === "READY" && file.previewFileId) {
    return { kind: "ready", driveFileId: file.previewFileId, mimeType: "application/pdf" };
  }
  if (file.previewStatus === "FAILED") {
    return { kind: "failed", reason: file.previewError ?? "The preview couldn't be generated." };
  }
  if (file.previewStatus === "PENDING") {
    return { kind: "pending" };
  }
  // NOT_STARTED for a non-PDF: this caller may be the one to convert it.

  if (!(await hooks.claimPending(file.id))) {
    // Someone else got there first; they'll finish it.
    return { kind: "pending" };
  }

  const client = drive();
  let googleDocId: string | null = null;

  try {
    // Drive does the conversion: copy into Google Docs format, then export that as a PDF.
    googleDocId = (
      await client.copyAsGoogleDoc({
        fileId: file.driveFileId,
        name: `${file.originalName} (converting)`,
      })
    ).id;

    const pdfStream = await client.exportPdfStream(googleDocId);

    const stored = await client.uploadStream({
      name: `${file.originalName}.pdf`,
      mimeType: "application/pdf",
      parentId: folderId(),
      body: pdfStream,
    });

    await hooks.markReady(file.id, stored.id);
    return { kind: "ready", driveFileId: stored.id, mimeType: "application/pdf" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await hooks.markFailed(file.id, reason);
    return { kind: "failed", reason };
  } finally {
    // The Google Doc was only a conversion vehicle; leaving it behind would clutter the folder
    // you're meant to be able to browse.
    if (googleDocId) {
      await client.deleteFile(googleDocId).catch(() => undefined);
    }
  }
}
