import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { env, isSheetsConfigured } from "@/lib/env";
import { MAPPABLE_FIELDS, appsScriptSnippet } from "@/lib/sheets";
import { SheetMapper } from "@/components/sheet-mapper";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  PageHeader,
  ScrollArea,
  formatDateTime,
} from "@/components/ui";
import {
  previewSheetAction,
  runSheetImportAction,
  saveSheetSourceAction,
  toggleSheetSourceAction,
} from "../actions";

export const metadata = { title: "Google Sheets — Hiring Portal" };

const STATUS_COLORS: Record<string, string> = {
  IMPORTED: "#16a34a",
  DUPLICATE: "#f59e0b",
  NEEDS_REVIEW: "#dc2626",
  ERROR: "#dc2626",
};

export default async function SheetsSettingsPage() {
  await requireAdmin();

  const [sources, roles, recentRows, recentRuns] = await Promise.all([
    prisma.sheetSource.findMany({
      include: {
        defaultJobRole: { select: { title: true } },
        _count: { select: { importedRows: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.jobRole.findMany({
      where: { status: { in: ["OPEN", "PAUSED", "DRAFT"] } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.importedRow.findMany({
      where: { status: { in: ["NEEDS_REVIEW", "ERROR"] } },
      orderBy: { importedAt: "desc" },
      take: 25,
    }),
    prisma.sheetSyncRun.findMany({
      include: { sheetSource: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);

  const existing = sources[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Sheets"
        description="Pull website leads into the funnel automatically."
        action={
          <Link href="/settings" className="text-sm font-medium underline">
            ← Settings
          </Link>
        }
      />

      {!isSheetsConfigured() ? (
        <Alert tone="warning" title="Google Sheets isn't configured yet">
          Create a Google Cloud service account, enable the Google Sheets API, and set{" "}
          <code className="font-mono text-xs">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and{" "}
          <code className="font-mono text-xs">GOOGLE_PRIVATE_KEY</code> on this deployment.
          Then share your leads spreadsheet with that service account email (viewer access is
          enough).
        </Alert>
      ) : (
        <Alert tone="info">
          Share your spreadsheet with{" "}
          <span className="font-mono text-xs font-semibold">
            {env().GOOGLE_SERVICE_ACCOUNT_EMAIL}
          </span>{" "}
          (viewer access) before importing.
        </Alert>
      )}

      {sources.length > 0 ? (
        <Card>
          <CardHeader title="Configured sources" />
          <ul className="divide-y divide-ink-100">
            {sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{source.name}</p>
                  <p className="truncate text-xs text-ink-500">
                    Tab &ldquo;{source.sheetName}&rdquo; · header row {source.headerRow} ·{" "}
                    {source.defaultJobRole
                      ? `defaults to ${source.defaultJobRole.title}`
                      : `role from column "${source.roleColumn}"`}
                  </p>
                  <p className="text-xs text-ink-400">
                    {source._count.importedRows} rows seen ·{" "}
                    {source.lastSyncedAt
                      ? `last synced ${formatDateTime(source.lastSyncedAt)}`
                      : "never synced"}
                  </p>
                </div>
                <Badge color={source.isActive ? "#16a34a" : "#f59e0b"}>
                  {source.isActive ? "Active" : "Paused"}
                </Badge>
                <ActionForm action={runSheetImportAction}>
                  <input type="hidden" name="sourceId" value={source.id} />
                  <SubmitButton size="sm" pendingLabel="Importing…">
                    Import now
                  </SubmitButton>
                </ActionForm>
                <form action={toggleSheetSourceAction}>
                  <input type="hidden" name="sourceId" value={source.id} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                    {source.isActive ? "Pause" : "Resume"}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={existing ? "Edit source" : "Connect your leads sheet"}
          description="Read the real column headers first, then map them to candidate fields."
        />
        <SheetMapper
          fields={MAPPABLE_FIELDS}
          roles={roles}
          previewAction={previewSheetAction}
          saveAction={saveSheetSourceAction}
          existing={
            existing
              ? {
                  name: existing.name,
                  spreadsheetId: existing.spreadsheetId,
                  sheetName: existing.sheetName,
                  headerRow: existing.headerRow,
                  columnMapping: (existing.columnMapping ?? {}) as Record<string, string>,
                  defaultJobRoleId: existing.defaultJobRoleId,
                  roleColumn: existing.roleColumn,
                }
              : undefined
          }
        />
      </Card>

      <Card>
        <CardHeader
          title="Near-real-time push (optional)"
          description="The scheduled pull runs every 10 minutes on its own. Add this script if you want leads to appear the moment they're submitted."
        />
        <div className="p-5">
          <pre className="board-scroll overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs leading-relaxed text-ink-100">
            <code>{appsScriptSnippet(env().SHEETS_WEBHOOK_SECRET ?? "SET_SHEETS_WEBHOOK_SECRET")}</code>
          </pre>
        </div>
      </Card>

      {recentRows.length > 0 ? (
        <Card>
          <CardHeader
            title="Rows needing review"
            description="Nothing is silently dropped — rows that couldn't be imported are kept here with the reason."
          />
          <ScrollArea>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Row</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Reason</th>
                  <th className="px-5 py-2.5 font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {recentRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-2 tabular-nums text-ink-600">
                      {row.sheetRowNumber ?? "—"}
                    </td>
                    <td className="px-5 py-2">
                      <Badge color={STATUS_COLORS[row.status]}>{row.status}</Badge>
                    </td>
                    <td className="px-5 py-2 text-ink-600">{row.error ?? "—"}</td>
                    <td className="max-w-md truncate px-5 py-2 font-mono text-xs text-ink-500">
                      {JSON.stringify(row.raw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      ) : null}

      {recentRuns.length > 0 ? (
        <Card>
          <CardHeader title="Recent sync runs" />
          <ScrollArea>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Started</th>
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-5 py-2.5 font-medium">Trigger</th>
                  <th className="px-5 py-2.5 text-right font-medium">Read</th>
                  <th className="px-5 py-2.5 text-right font-medium">Imported</th>
                  <th className="px-5 py-2.5 text-right font-medium">Duplicates</th>
                  <th className="px-5 py-2.5 text-right font-medium">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-5 py-2 text-ink-500">{formatDateTime(run.startedAt)}</td>
                    <td className="px-5 py-2 text-ink-700">{run.sheetSource.name}</td>
                    <td className="px-5 py-2">
                      <Badge>{run.trigger}</Badge>
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">{run.rowsRead}</td>
                    <td className="px-5 py-2 text-right tabular-nums font-medium text-green-700">
                      {run.createdCount}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink-600">
                      {run.duplicateCount}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink-600">
                      {run.errorCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      ) : null}
    </div>
  );
}
