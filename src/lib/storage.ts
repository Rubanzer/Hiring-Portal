import "server-only";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isStorageConfigured } from "./env";

/**
 * Resume storage on any S3-compatible bucket (Cloudflare R2, Supabase Storage, MinIO, S3).
 *
 * Bytes never pass through the app server: the browser PUTs straight to a signed URL, and
 * downloads go through /api/files/[id], which authorises the request and then redirects to a
 * short-lived signed GET. The bucket itself stays private.
 */

export const ALLOWED_RESUME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

let client: S3Client | null = null;

function s3(): S3Client {
  if (!isStorageConfigured()) {
    throw new StorageNotConfiguredError();
  }
  const e = env();
  client ??= new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE ?? true,
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY_ID!,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Resume storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

/** Namespaced, unguessable object key. The original filename is kept in the database, not here. */
export function buildStorageKey(originalName: string, mimeType: string): string {
  const ext = ALLOWED_RESUME_TYPES[mimeType] ?? guessExtension(originalName) ?? "bin";
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `resumes/${yyyymm}/${randomUUID()}.${ext}`;
}

function guessExtension(name: string): string | null {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

/** Validates a proposed upload before a signed URL is handed out. */
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

export async function createUploadUrl(params: {
  storageKey: string;
  mimeType: string;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env().S3_BUCKET!,
    Key: params.storageKey,
    ContentType: params.mimeType,
  });
  return getSignedUrl(s3(), command, { expiresIn: 300 });
}

/** Short-lived read URL. 60 seconds is enough to follow a redirect and not much else. */
export async function createDownloadUrl(params: {
  storageKey: string;
  fileName: string;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env().S3_BUCKET!,
    Key: params.storageKey,
    ResponseContentDisposition: `inline; filename="${params.fileName.replace(/"/g, "")}"`,
  });
  return getSignedUrl(s3(), command, { expiresIn: 60 });
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
  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return "application/msword";
  }

  return null;
}
