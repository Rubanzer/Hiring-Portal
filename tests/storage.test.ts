import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
// Type-only, so it's erased and doesn't load the module before the env vars below are set.
import type { DriveClient } from "../src/lib/storage";

process.env.DATABASE_URL ??= "postgresql://unused";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??= "portal@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY ??= "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----";
process.env.GOOGLE_DRIVE_FOLDER_ID ??= "folder-123";

const {
  beginUpload,
  confirmUpload,
  ensurePreview,
  MAX_RESUME_BYTES,
  needsPreviewConversion,
  setDriveClient,
  toWebStream,
  validateResumeUpload,
} = await import("../src/lib/storage");

/**
 * Google Drive is the only place resumes live, so these cover the parts that decide whether a
 * resume is safe, reachable and readable — without needing a Workspace account to run.
 */

function stubDrive(overrides: Partial<DriveClient> = {}) {
  const calls = {
    createFile: 0,
    copyAsGoogleDoc: 0,
    uploadStream: 0,
    deleteFile: 0,
  };

  const client: DriveClient = {
    async createFile() {
      calls.createFile += 1;
      return { id: `drive-${calls.createFile}` };
    },
    async getFile() {
      return { id: "drive-1", size: 1024, mimeType: "application/pdf" };
    },
    async openResumableSession() {
      return "https://www.googleapis.com/upload/session/abc";
    },
    async downloadStream() {
      return Readable.from([Buffer.from("%PDF-1.7 fake")]);
    },
    async copyAsGoogleDoc() {
      calls.copyAsGoogleDoc += 1;
      return { id: "gdoc-1" };
    },
    async exportPdfStream() {
      return Readable.from([Buffer.from("%PDF converted")]);
    },
    async uploadStream() {
      calls.uploadStream += 1;
      return { id: `preview-${calls.uploadStream}` };
    },
    async deleteFile() {
      calls.deleteFile += 1;
    },
    ...overrides,
  };

  setDriveClient(client);
  return calls;
}

afterEach(() => setDriveClient(null));

describe("validateResumeUpload", () => {
  it("accepts the formats agencies actually send", () => {
    for (const mimeType of [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(
        validateResumeUpload({ fileName: "cv", mimeType, sizeBytes: 1024 }),
        mimeType,
      ).toBeNull();
    }
  });

  it("rejects anything else", () => {
    expect(
      validateResumeUpload({ fileName: "cv.txt", mimeType: "text/plain", sizeBytes: 10 }),
    ).toMatch(/PDF, DOC or DOCX/);
  });

  it("allows files well past the old 10 MB ceiling", () => {
    // The whole reason for the Drive rework: scanned CVs regularly exceed 10 MB.
    expect(MAX_RESUME_BYTES).toBeGreaterThan(10 * 1024 * 1024);
    expect(
      validateResumeUpload({
        fileName: "scan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 20 * 1024 * 1024,
      }),
    ).toBeNull();
  });

  it("still has an upper bound", () => {
    expect(
      validateResumeUpload({
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_RESUME_BYTES + 1,
      }),
    ).toMatch(/must be under/);
  });

  it("rejects an empty file", () => {
    expect(
      validateResumeUpload({ fileName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 0 }),
    ).toMatch(/empty/);
  });
});

describe("beginUpload", () => {
  it("takes the Drive id from the API, never from the caller", async () => {
    stubDrive();

    const result = await beginUpload({ fileName: "cv.pdf", mimeType: "application/pdf" });

    // If this id could come from the client, an agency could attach a submission to another
    // agency's resume just by sending a different one back.
    expect(result.driveFileId).toBe("drive-1");
    expect(result.uploadUrl).toContain("googleapis.com/upload");
  });

  it("creates the file in the configured folder", async () => {
    const seen: string[] = [];
    stubDrive({
      async createFile({ parentId }) {
        seen.push(parentId);
        return { id: "drive-1" };
      },
    });

    await beginUpload({ fileName: "cv.pdf", mimeType: "application/pdf" });
    expect(seen).toEqual(["folder-123"]);
  });
});

describe("confirmUpload", () => {
  it("accepts a file Drive says has bytes", async () => {
    stubDrive();
    await expect(confirmUpload("drive-1")).resolves.toEqual({ ok: true, sizeBytes: 1024 });
  });

  it("rejects an upload that never completed", async () => {
    // The record is created before the browser uploads, so a zero-byte file means the upload
    // was abandoned — attaching it would look fine until someone opened the resume.
    stubDrive({
      async getFile() {
        return { id: "drive-1", size: 0, mimeType: "application/pdf" };
      },
    });

    const result = await confirmUpload("drive-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/didn't complete/);
  });

  it("rejects a file Drive can't find", async () => {
    stubDrive({
      async getFile() {
        return null;
      },
    });

    const result = await confirmUpload("missing");
    expect(result.ok).toBe(false);
  });

  it("catches a browser that under-reported the size", async () => {
    stubDrive({
      async getFile() {
        return { id: "d", size: MAX_RESUME_BYTES + 1, mimeType: "application/pdf" };
      },
    });

    const result = await confirmUpload("drive-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/larger than/);
  });
});

describe("needsPreviewConversion", () => {
  it("is false for PDFs and true for Word files", () => {
    expect(needsPreviewConversion("application/pdf")).toBe(false);
    expect(needsPreviewConversion("application/msword")).toBe(true);
    expect(
      needsPreviewConversion(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });
});

describe("ensurePreview", () => {
  const wordFile = {
    id: "file-1",
    driveFileId: "drive-1",
    originalName: "cv.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    previewFileId: null,
    previewStatus: "NOT_STARTED",
    previewError: null,
  };

  function hooks() {
    return {
      claimPending: vi.fn().mockResolvedValue(true),
      markReady: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("streams a PDF as-is without converting anything", async () => {
    const calls = stubDrive();
    const h = hooks();

    const result = await ensurePreview(
      { ...wordFile, originalName: "cv.pdf", mimeType: "application/pdf" },
      h,
    );

    expect(result).toEqual({
      kind: "ready",
      driveFileId: "drive-1",
      mimeType: "application/pdf",
    });
    expect(calls.copyAsGoogleDoc).toBe(0);
    expect(h.claimPending).not.toHaveBeenCalled();
  });

  it("converts a Word file once and reports the stored PDF", async () => {
    const calls = stubDrive();
    const h = hooks();

    const result = await ensurePreview(wordFile, h);

    expect(result).toEqual({
      kind: "ready",
      driveFileId: "preview-1",
      mimeType: "application/pdf",
    });
    expect(h.markReady).toHaveBeenCalledWith("file-1", "preview-1");
    // The intermediate Google Doc is cleaned up, or the folder you browse fills with junk.
    expect(calls.deleteFile).toBe(1);
  });

  it("serves the cached PDF instead of converting again", async () => {
    const calls = stubDrive();
    const h = hooks();

    const result = await ensurePreview(
      { ...wordFile, previewStatus: "READY", previewFileId: "preview-cached" },
      h,
    );

    expect(result).toEqual({
      kind: "ready",
      driveFileId: "preview-cached",
      mimeType: "application/pdf",
    });
    expect(calls.copyAsGoogleDoc).toBe(0);
  });

  it("does not convert twice when two people open the same CV at once", async () => {
    const calls = stubDrive();
    const h = hooks();
    // The second viewer loses the atomic claim.
    h.claimPending.mockResolvedValue(false);

    const result = await ensurePreview(wordFile, h);

    expect(result).toEqual({ kind: "pending" });
    expect(calls.copyAsGoogleDoc).toBe(0);
  });

  it("reports a conversion already in flight as pending", async () => {
    stubDrive();
    const h = hooks();

    expect(await ensurePreview({ ...wordFile, previewStatus: "PENDING" }, h)).toEqual({
      kind: "pending",
    });
    expect(h.claimPending).not.toHaveBeenCalled();
  });

  it("records a failure rather than retrying forever", async () => {
    const calls = stubDrive({
      async copyAsGoogleDoc() {
        throw new Error("Drive said no");
      },
    });
    const h = hooks();

    const result = await ensurePreview(wordFile, h);

    expect(result.kind).toBe("failed");
    expect(h.markFailed).toHaveBeenCalledWith("file-1", "Drive said no");
    // Nothing to clean up when the copy itself failed.
    expect(calls.deleteFile).toBe(0);
  });

  it("surfaces a stored failure without retrying", async () => {
    const calls = stubDrive();
    const h = hooks();

    const result = await ensurePreview(
      { ...wordFile, previewStatus: "FAILED", previewError: "corrupt file" },
      h,
    );

    expect(result).toEqual({ kind: "failed", reason: "corrupt file" });
    expect(calls.copyAsGoogleDoc).toBe(0);
  });
});

describe("toWebStream", () => {
  /**
   * The load-bearing assertion for files over 4.5 MB.
   *
   * Vercel caps a function's response body at 4.5 MB but exempts streamed responses. If a read
   * path ever collects bytes into a Buffer, downloads keep working for small fixtures and fail
   * only for the large scanned CVs this whole rework exists to support — so the streaming
   * property is asserted directly rather than inferred from a download that happened to work.
   */
  it("produces a ReadableStream, not a buffered body", () => {
    const stream = toWebStream(Readable.from([Buffer.from("hello")]));
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("yields the bytes in order without holding them all at once", async () => {
    const chunks = [Buffer.from("abc"), Buffer.from("def"), Buffer.from("ghi")];
    const stream = toWebStream(Readable.from(chunks));

    const reader = stream.getReader();
    const seen: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(Buffer.from(value).toString());
    }

    // Arriving as separate chunks is the evidence it streams rather than buffers.
    expect(seen).toEqual(["abc", "def", "ghi"]);
  });
});
