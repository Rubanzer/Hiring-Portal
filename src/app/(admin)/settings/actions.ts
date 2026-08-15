"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, recordActivity } from "@/lib/auth";
import { slugify } from "@/lib/normalize";
import {
  extractSpreadsheetId,
  importSheetSource,
  readSheet,
  SheetsNotConfiguredError,
} from "@/lib/sheets";
import type { FormState } from "@/components/action-form";

// --- Funnel stages -------------------------------------------------------

const stagesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string().min(1, "Every stage needs a name.").max(80),
    kind: z.enum(["ACTIVE", "WON", "LOST", "HOLD"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #0ea5e9."),
    visibleToAgency: z.boolean(),
    isDefault: z.boolean(),
  }),
);

/**
 * Saves the whole funnel in one go.
 *
 * Stages are never hard-deleted here — removing one from the list marks it inactive, because
 * applications and history rows point at it and deleting would orphan them. Inactive stages
 * disappear from the board but stay readable in a candidate's timeline.
 */
export async function saveStagesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("stages") ?? "[]"));
  } catch {
    return { error: "Couldn't read the stage list. Reload and try again." };
  }

  const parsed = stagesSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const stages = parsed.data;
  if (stages.length === 0) return { error: "Keep at least one stage." };
  if (!stages.some((s) => s.kind === "ACTIVE")) {
    return { error: "At least one stage must be an active pipeline stage." };
  }

  const defaults = stages.filter((s) => s.isDefault);
  if (defaults.length !== 1) {
    return { error: "Exactly one stage must be the entry stage for new candidates." };
  }
  if (defaults[0].kind !== "ACTIVE") {
    return { error: "The entry stage must be an active stage." };
  }

  const keptIds = stages.filter((s) => !s.id.startsWith("new-")).map((s) => s.id);

  await prisma.$transaction(async (tx) => {
    // Clear the default first: the partial unique index allows only one true at a time.
    await tx.stage.updateMany({ data: { isDefault: false }, where: { isDefault: true } });

    await tx.stage.updateMany({
      where: { id: { notIn: keptIds.length ? keptIds : ["-"] } },
      data: { isActive: false, isDefault: false },
    });

    for (const [index, stage] of stages.entries()) {
      const data = {
        name: stage.name.trim(),
        sortOrder: index,
        kind: stage.kind,
        color: stage.color,
        visibleToAgency: stage.visibleToAgency,
        isDefault: stage.isDefault,
        isActive: true,
      };

      if (stage.id.startsWith("new-")) {
        await tx.stage.create({
          data: { ...data, slug: await uniqueStageSlug(tx, slugify(stage.name)) },
        });
      } else {
        await tx.stage.update({ where: { id: stage.id }, data });
      }
    }
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "stage",
    action: "stages_saved",
    meta: { count: stages.length },
  });

  revalidatePath("/settings");
  revalidatePath("/funnel");
  return { success: "Funnel saved." };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function uniqueStageSlug(tx: TxClient, base: string): Promise<string> {
  const root = base || "stage";
  let candidate = root;
  let n = 1;
  while (await tx.stage.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

// --- Google Sheets sources ----------------------------------------------

const sheetSourceSchema = z.object({
  name: z.string().min(2, "Give this source a name.").max(120),
  spreadsheetId: z.string().min(10, "That doesn't look like a spreadsheet ID."),
  sheetName: z.string().min(1, "Which tab should be read?").max(120),
  headerRow: z.coerce.number().int().min(1).max(50),
  defaultJobRoleId: z.string().optional(),
  roleColumn: z.string().optional(),
  columnMapping: z.string(),
});

export async function saveSheetSourceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const parsed = sheetSourceSchema.safeParse({
    name: formData.get("name"),
    spreadsheetId: formData.get("spreadsheetId"),
    sheetName: formData.get("sheetName"),
    headerRow: formData.get("headerRow") || 1,
    defaultJobRoleId: formData.get("defaultJobRoleId") ?? undefined,
    roleColumn: formData.get("roleColumn") ?? undefined,
    columnMapping: formData.get("columnMapping") ?? "{}",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let columnMapping: Record<string, string>;
  try {
    columnMapping = JSON.parse(parsed.data.columnMapping);
  } catch {
    return { error: "Couldn't read the column mapping." };
  }

  if (!Object.values(columnMapping).includes("fullName")) {
    return { error: "Map one column to Full name — without it, a row can't become a candidate." };
  }
  if (!parsed.data.defaultJobRoleId && !parsed.data.roleColumn) {
    return {
      error: "Pick a default role, or name the column that says which role the lead is for.",
    };
  }

  // A spreadsheet ID pasted as a full URL is the single most common setup mistake.
  const spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheetId);

  const source = await prisma.sheetSource.upsert({
    where: {
      spreadsheetId_sheetName: { spreadsheetId, sheetName: parsed.data.sheetName },
    },
    update: {
      name: parsed.data.name.trim(),
      headerRow: parsed.data.headerRow,
      columnMapping: columnMapping as never,
      defaultJobRoleId: parsed.data.defaultJobRoleId || null,
      roleColumn: parsed.data.roleColumn?.trim() || null,
      isActive: true,
    },
    create: {
      name: parsed.data.name.trim(),
      spreadsheetId,
      sheetName: parsed.data.sheetName,
      headerRow: parsed.data.headerRow,
      columnMapping: columnMapping as never,
      defaultJobRoleId: parsed.data.defaultJobRoleId || null,
      roleColumn: parsed.data.roleColumn?.trim() || null,
    },
  });

  await recordActivity({
    actorUserId: admin.id,
    entityType: "sheet_source",
    entityId: source.id,
    action: "sheet_source_saved",
  });

  revalidatePath("/settings/sheets");
  return { success: `Saved. Run an import to pull in existing rows.` };
}

/** Reads the first rows of a sheet so the admin can map columns against real headers. */
export async function previewSheetAction(
  _prev: FormState & { headers?: string[]; sample?: string[][] },
  formData: FormData,
): Promise<FormState & { headers?: string[]; sample?: string[][] }> {
  await requireAdmin();

  const spreadsheetId = extractSpreadsheetId(String(formData.get("spreadsheetId") ?? ""));
  const sheetName = String(formData.get("sheetName") ?? "").trim();
  const headerRow = Number.parseInt(String(formData.get("headerRow") ?? "1"), 10) || 1;

  if (!spreadsheetId || !sheetName) {
    return { error: "Enter the spreadsheet ID and the tab name first." };
  }

  try {
    const rows = await readSheet({
      spreadsheetId,
      sheetName,
      range: `A1:Z${headerRow + 5}`,
    });

    const headers = (rows[headerRow - 1] ?? []).map((h) => h.trim()).filter(Boolean);
    if (headers.length === 0) {
      return { error: `Row ${headerRow} of "${sheetName}" is empty — is the header row right?` };
    }

    return { success: `Found ${headers.length} columns.`, headers, sample: rows.slice(headerRow, headerRow + 5) };
  } catch (error) {
    if (error instanceof SheetsNotConfiguredError) return { error: error.message };
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message.includes("not found")
        ? `Couldn't open that sheet. Check the ID, and make sure the sheet is shared with the service account.`
        : `Couldn't read the sheet: ${message}`,
    };
  }
}

export async function runSheetImportAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return { error: "No source specified." };

  try {
    const outcome = await importSheetSource(sourceId, "MANUAL");

    await recordActivity({
      actorUserId: admin.id,
      entityType: "sheet_source",
      entityId: sourceId,
      action: "manual_import",
      meta: { created: outcome.created },
    });

    revalidatePath("/settings/sheets");
    revalidatePath("/funnel");

    const parts = [
      `${outcome.created} imported`,
      `${outcome.duplicates} already in the pipeline`,
    ];
    if (outcome.needsReview) parts.push(`${outcome.needsReview} need review`);

    return {
      success: `Read ${outcome.rowsRead} rows: ${parts.join(", ")}.${
        outcome.messages.length ? ` First issue: ${outcome.messages[0]}` : ""
      }`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The import failed.",
    };
  }
}

export async function toggleSheetSourceAction(formData: FormData) {
  await requireAdmin();
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return;

  const source = await prisma.sheetSource.findUnique({ where: { id: sourceId } });
  if (!source) return;

  await prisma.sheetSource.update({
    where: { id: sourceId },
    data: { isActive: !source.isActive },
  });

  revalidatePath("/settings/sheets");
}
