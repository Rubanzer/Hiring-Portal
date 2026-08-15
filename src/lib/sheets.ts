import "server-only";
import { timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { prisma } from "./db";
import { env, isSheetsConfigured } from "./env";
import { createSubmission } from "./submissions";
import { parseExperienceMonths } from "./normalize";
import { hashRow, mapRow, type ColumnMapping } from "./sheet-mapping";
import type { SyncTrigger } from "@/generated/prisma/enums";

/**
 * Ingests website leads from Google Sheets.
 *
 * Two triggers, one code path: an Apps Script webhook fires the moment a row is added, and a
 * scheduled pull sweeps the sheet every few minutes as a safety net. Both are safe to run
 * together because every row is keyed by a content hash in `imported_rows` — whichever
 * arrives second is a no-op, not a duplicate candidate.
 *
 * The pure parts (hashing, column mapping, ID extraction) live in ./sheet-mapping so they can
 * be unit-tested without credentials; they're re-exported here for convenience.
 */

export {
  MAPPABLE_FIELDS,
  hashRow,
  mapRow,
  extractSpreadsheetId,
  type MappableField,
  type ColumnMapping,
} from "./sheet-mapping";

export class SheetsNotConfiguredError extends Error {
  constructor() {
    super(
      "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.",
    );
    this.name = "SheetsNotConfiguredError";
  }
}

function sheetsClient() {
  if (!isSheetsConfigured()) throw new SheetsNotConfiguredError();

  const auth = new google.auth.JWT({
    email: env().GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Private keys pasted into env vars arrive with literal \n sequences.
    key: env().GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

/** Reads a range verbatim. Used by the mapping UI's preview and by the importer. */
export async function readSheet(params: {
  spreadsheetId: string;
  sheetName: string;
  range?: string;
}): Promise<string[][]> {
  const sheets = sheetsClient();
  const range = params.range ? `${params.sheetName}!${params.range}` : `${params.sheetName}`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: params.spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return (response.data.values ?? []).map((row) =>
    (row as unknown[]).map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );
}

export type ImportOutcome = {
  rowsRead: number;
  created: number;
  duplicates: number;
  errors: number;
  needsReview: number;
  messages: string[];
};

/**
 * Imports every unseen row from a sheet source.
 *
 * Rows that can't be mapped are stored as NEEDS_REVIEW rather than discarded — a lead that
 * arrives with a malformed phone number is still a lead, and silently dropping it is how a
 * pipeline loses people without anyone noticing.
 */
export async function importSheetSource(
  sheetSourceId: string,
  trigger: SyncTrigger,
): Promise<ImportOutcome> {
  const source = await prisma.sheetSource.findUnique({ where: { id: sheetSourceId } });
  if (!source) throw new Error("Sheet source not found.");

  if (!source.isActive) {
    return {
      rowsRead: 0,
      created: 0,
      duplicates: 0,
      errors: 0,
      needsReview: 0,
      messages: ["Source is paused."],
    };
  }

  const run = await prisma.sheetSyncRun.create({ data: { sheetSourceId, trigger } });

  const outcome: ImportOutcome = {
    rowsRead: 0,
    created: 0,
    duplicates: 0,
    errors: 0,
    needsReview: 0,
    messages: [],
  };

  try {
    const rows = await readSheet({
      spreadsheetId: source.spreadsheetId,
      sheetName: source.sheetName,
    });

    const headerIndex = source.headerRow - 1;
    const headers = (rows[headerIndex] ?? []).map((h) => h.trim());
    const dataRows = rows.slice(headerIndex + 1);
    const mapping = (source.columnMapping ?? {}) as ColumnMapping;

    outcome.rowsRead = dataRows.length;

    // Role lookup by name, when the sheet says which role the lead is for.
    const roleByTitle = new Map<string, string>();
    if (source.roleColumn) {
      const roles = await prisma.jobRole.findMany({ select: { id: true, title: true } });
      for (const role of roles) roleByTitle.set(role.title.trim().toLowerCase(), role.id);
    }

    for (const [offset, values] of dataRows.entries()) {
      if (values.every((v) => v.trim() === "")) continue;

      const rowHash = hashRow(source.id, values);

      // Cheap pre-check; the unique index on rowHash is the real guarantee.
      const seen = await prisma.importedRow.findUnique({ where: { rowHash } });
      if (seen) continue;

      const sheetRowNumber = source.headerRow + offset + 1;
      const mapped = mapRow(headers, values, mapping);
      const raw = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));

      const jobRoleId = source.roleColumn
        ? (roleByTitle.get((raw[source.roleColumn] ?? "").trim().toLowerCase()) ??
          source.defaultJobRoleId)
        : source.defaultJobRoleId;

      if (!mapped.fullName) {
        await recordRow({
          sheetSourceId: source.id,
          rowHash,
          sheetRowNumber,
          raw,
          status: "NEEDS_REVIEW",
          error: "No name could be read from this row.",
        });
        outcome.needsReview += 1;
        continue;
      }

      if (!jobRoleId) {
        await recordRow({
          sheetSourceId: source.id,
          rowHash,
          sheetRowNumber,
          raw,
          status: "NEEDS_REVIEW",
          error: "Couldn't tell which role this lead is for, and no default role is set.",
        });
        outcome.needsReview += 1;
        continue;
      }

      const result = await createSubmission({
        jobRoleId,
        source: "WEBSITE",
        agencyId: null,
        submittedByUserId: null,
        fullName: mapped.fullName,
        email: mapped.email ?? null,
        phone: mapped.phone ?? null,
        currentCompany: mapped.currentCompany ?? null,
        currentTitle: mapped.currentTitle ?? null,
        currentLocation: mapped.currentLocation ?? null,
        linkedinUrl: mapped.linkedinUrl ?? null,
        totalExperienceMonths: parseExperienceMonths(mapped.experience ?? null),
        currentCtc: mapped.currentCtc ?? null,
        expectedCtc: mapped.expectedCtc ?? null,
        noticePeriod: mapped.noticePeriod ?? null,
        agencyNotes: mapped.notes ?? null,
      });

      if (result.status === "created") {
        outcome.created += 1;
        await recordRow({
          sheetSourceId: source.id,
          rowHash,
          sheetRowNumber,
          raw,
          status: "IMPORTED",
          candidateId: result.candidateId,
          applicationId: result.applicationId,
        });
      } else if (result.status === "duplicate") {
        outcome.duplicates += 1;
        await recordRow({
          sheetSourceId: source.id,
          rowHash,
          sheetRowNumber,
          raw,
          status: "DUPLICATE",
          error: result.message,
        });
      } else {
        outcome.needsReview += 1;
        outcome.messages.push(`Row ${sheetRowNumber}: ${result.message}`);
        await recordRow({
          sheetSourceId: source.id,
          rowHash,
          sheetRowNumber,
          raw,
          status: "NEEDS_REVIEW",
          error: result.message,
        });
      }
    }

    await prisma.sheetSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date(), lastRowCursor: dataRows.length },
    });
  } catch (error) {
    outcome.errors += 1;
    outcome.messages.push(error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.sheetSyncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        rowsRead: outcome.rowsRead,
        createdCount: outcome.created,
        duplicateCount: outcome.duplicates,
        errorCount: outcome.errors + outcome.needsReview,
        errors: outcome.messages.length ? (outcome.messages as never) : undefined,
      },
    });
  }

  return outcome;
}

/** Writes the ledger entry, tolerating the race where both triggers reach the same row. */
async function recordRow(params: {
  sheetSourceId: string;
  rowHash: string;
  sheetRowNumber: number;
  raw: Record<string, string>;
  status: "IMPORTED" | "DUPLICATE" | "ERROR" | "NEEDS_REVIEW";
  error?: string;
  candidateId?: string;
  applicationId?: string;
}) {
  try {
    await prisma.importedRow.create({
      data: {
        sheetSourceId: params.sheetSourceId,
        rowHash: params.rowHash,
        sheetRowNumber: params.sheetRowNumber,
        raw: params.raw as never,
        status: params.status,
        error: params.error ?? null,
        candidateId: params.candidateId ?? null,
        applicationId: params.applicationId ?? null,
      },
    });
  } catch (error) {
    // P2002 here means the other trigger got there first — exactly what the hash is for.
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      )
    ) {
      throw error;
    }
  }
}

/** Imports every active source. Used by the cron route. */
export async function importAllSources(trigger: SyncTrigger) {
  const sources = await prisma.sheetSource.findMany({ where: { isActive: true } });
  const results: Array<{ sourceId: string; name: string; outcome: ImportOutcome }> = [];

  for (const source of sources) {
    try {
      results.push({
        sourceId: source.id,
        name: source.name,
        outcome: await importSheetSource(source.id, trigger),
      });
    } catch (error) {
      results.push({
        sourceId: source.id,
        name: source.name,
        outcome: {
          rowsRead: 0,
          created: 0,
          duplicates: 0,
          errors: 1,
          needsReview: 0,
          messages: [error instanceof Error ? error.message : String(error)],
        },
      });
    }
  }

  return results;
}

/** Constant-time comparison of a shared secret, so the check can't be timed. */
export function verifySharedSecret(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The Apps Script to paste into the leads spreadsheet, filled in with this deployment's URL. */
export function appsScriptSnippet(webhookSecret: string): string {
  return `/**
 * Hiring Portal — push new rows the moment they arrive.
 *
 * Setup:
 *   1. In your Google Sheet: Extensions → Apps Script.
 *   2. Paste this in, replacing anything already there.
 *   3. Triggers (clock icon) → Add trigger → onFormSubmitOrEdit, From spreadsheet,
 *      On form submit.  Add a second trigger for "On change" if rows are pasted in manually.
 *   4. Save. The scheduled pull in the portal will catch anything this misses.
 */
const PORTAL_WEBHOOK_URL = '${env().APP_URL}/api/webhooks/sheets';
const PORTAL_SECRET = '${webhookSecret}';

function onFormSubmitOrEdit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  const payload = {
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
    sheetName: sheet.getName(),
  };

  UrlFetchApp.fetch(PORTAL_WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Portal-Secret': PORTAL_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
`;
}
