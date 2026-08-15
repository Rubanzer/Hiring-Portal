"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, ScrollArea } from "@/components/ui";
import { SubmitButton, type FormState } from "@/components/action-form";

/**
 * Two-step setup for a leads spreadsheet: read the real headers, then map them.
 *
 * Mapping against columns fetched from the actual sheet rather than typed from memory is the
 * difference between an import that works first time and one that silently drops every phone
 * number because the column is called "Contact No." and not "Phone".
 */

export type FieldOption = { key: string; label: string; required?: boolean };

type PreviewState = FormState & { headers?: string[]; sample?: string[][] };

export function SheetMapper({
  fields,
  roles,
  previewAction,
  saveAction,
  existing,
}: {
  fields: readonly FieldOption[];
  roles: Array<{ id: string; title: string }>;
  previewAction: (prev: PreviewState, formData: FormData) => Promise<PreviewState>;
  saveAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  existing?: {
    name: string;
    spreadsheetId: string;
    sheetName: string;
    headerRow: number;
    columnMapping: Record<string, string>;
    defaultJobRoleId: string | null;
    roleColumn: string | null;
  };
}) {
  const [preview, previewFormAction] = useActionState<PreviewState, FormData>(
    previewAction,
    {},
  );
  const [saveState, saveFormAction] = useActionState<FormState, FormData>(saveAction, {});

  const [spreadsheetId, setSpreadsheetId] = useState(existing?.spreadsheetId ?? "");
  const [sheetName, setSheetName] = useState(existing?.sheetName ?? "Sheet1");
  const [headerRow, setHeaderRow] = useState(String(existing?.headerRow ?? 1));
  const [mapping, setMapping] = useState<Record<string, string>>(
    existing?.columnMapping ?? {},
  );

  const headers = preview.headers ?? Object.keys(existing?.columnMapping ?? {});
  const mappedFullName = Object.values(mapping).includes("fullName");

  return (
    <div className="space-y-5 p-5">
      {/* Step 1 — read the sheet */}
      <form action={previewFormAction} className="space-y-4">
        <input type="hidden" name="spreadsheetId" value={spreadsheetId} />
        <input type="hidden" name="sheetName" value={sheetName} />
        <input type="hidden" name="headerRow" value={headerRow} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Spreadsheet ID or URL"
            hint="Paste the whole URL — the ID is extracted for you."
            required
          >
            <Input
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
          </Field>
          <Field label="Tab name" required>
            <Input
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="Form Responses 1"
            />
          </Field>
          <Field label="Header row" hint="Which row holds the column names.">
            <Input
              type="number"
              min={1}
              value={headerRow}
              onChange={(e) => setHeaderRow(e.target.value)}
            />
          </Field>
        </div>

        {preview.error ? <Alert tone="error">{preview.error}</Alert> : null}

        <SubmitButton variant="secondary" pendingLabel="Reading sheet…">
          Read columns from the sheet
        </SubmitButton>

        <p className="text-xs text-ink-500">
          The sheet must be shared (viewer is enough) with this deployment&apos;s Google service
          account email.
        </p>
      </form>

      {preview.sample && preview.sample.length > 0 ? (
        <ScrollArea className="rounded-lg border border-ink-200">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="bg-ink-50 text-left text-ink-500">
              <tr>
                {headers.map((header) => (
                  <th key={header} className="px-3 py-2 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {preview.sample.map((row, i) => (
                <tr key={i}>
                  {headers.map((_, j) => (
                    <td key={j} className="max-w-40 truncate px-3 py-1.5 text-ink-600">
                      {row[j] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      ) : null}

      {/* Step 2 — map and save */}
      {headers.length > 0 ? (
        <form action={saveFormAction} className="space-y-4 border-t border-ink-200 pt-5">
          <input type="hidden" name="spreadsheetId" value={spreadsheetId} />
          <input type="hidden" name="sheetName" value={sheetName} />
          <input type="hidden" name="headerRow" value={headerRow} />
          <input type="hidden" name="columnMapping" value={JSON.stringify(mapping)} />

          {saveState.error ? <Alert tone="error">{saveState.error}</Alert> : null}
          {saveState.success ? <Alert tone="success">{saveState.success}</Alert> : null}

          <Field label="Name this source" required>
            <Input
              name="name"
              defaultValue={existing?.name ?? "Website leads"}
              required
              placeholder="Website leads"
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-ink-700">Map columns</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {headers.map((header) => (
                <div key={header} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-sm text-ink-600" title={header}>
                    {header}
                  </span>
                  <Select
                    className="h-9 flex-1"
                    value={mapping[header] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (e.target.value) next[header] = e.target.value;
                        else delete next[header];
                        return next;
                      })
                    }
                  >
                    <option value="">Ignore this column</option>
                    {fields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                        {field.required ? " *" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!mappedFullName ? (
              <p className="mt-2 text-xs font-medium text-amber-700">
                Map one column to Full name before saving.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default role"
              hint="Leads land against this role unless the sheet says otherwise."
            >
              <Select name="defaultJobRoleId" defaultValue={existing?.defaultJobRoleId ?? ""}>
                <option value="">No default</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Role column (optional)"
              hint="If a column names the role, match it by title."
            >
              <Select name="roleColumn" defaultValue={existing?.roleColumn ?? ""}>
                <option value="">None — always use the default</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex gap-3">
            <SubmitButton pendingLabel="Saving…">Save source</SubmitButton>
            <Button type="reset" variant="ghost">
              Reset
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
