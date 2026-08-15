"use client";

import { useState } from "react";
import Link from "next/link";
import { useActionState } from "react";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  ScrollArea,
  Select,
  cn,
  formatCurrency,
  formatDate,
} from "@/components/ui";
import { SubmitButton, type FormState } from "@/components/action-form";
import { bulkMoveStageAction } from "@/app/(admin)/funnel/actions";

/**
 * Dense table view with row selection and a bulk stage move.
 *
 * The board is for working one candidate at a time; this is for the Monday-morning pass where
 * you shortlist twenty at once.
 */

export type TableRow = {
  id: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  roleTitle: string;
  sourceLabel: string;
  agencyName: string | null;
  stageName: string;
  stageColor: string;
  ownerName: string | null;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  daysInStage: number;
  flagged: boolean;
  createdAt: string;
};

export function FunnelTable({
  rows,
  stages,
}: {
  rows: TableRow[];
  stages: Array<{ id: string; name: string }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction] = useActionState<FormState, FormData>(bulkMoveStageAction, {});

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title="Candidates"
        description={`${rows.length} shown${rows.length >= 500 ? " (capped at 500 — narrow the filters)" : ""}`}
      />

      {state.error ? (
        <div className="px-5 pt-4">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}
      {state.success ? (
        <div className="px-5 pt-4">
          <Alert tone="success">{state.success}</Alert>
        </div>
      ) : null}

      <form action={formAction}>
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-5 py-3">
            <span className="text-sm font-medium text-ink-700">
              {selected.size} selected
            </span>
            <Select name="toStageId" className="h-9 w-56" required>
              <option value="">Move to stage…</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="applicationIds" value={id} />
            ))}
            <SubmitButton size="sm" pendingLabel="Moving…">
              Move selected
            </SubmitButton>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-ink-500 underline"
            >
              Clear
            </button>
          </div>
        ) : null}

        <ScrollArea>
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    className="size-4 rounded border-ink-300"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-2.5 font-medium">Candidate</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                <th className="px-4 py-2.5 text-right font-medium">Notice</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn("hover:bg-ink-50", selected.has(row.id) && "bg-sky-50/60")}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className="size-4 rounded border-ink-300"
                      aria-label={`Select ${row.candidateName}`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/candidates/${row.id}`}
                      className="font-medium text-ink-900 hover:underline"
                    >
                      {row.candidateName}
                    </Link>
                    <p className="text-xs text-ink-500">{row.email ?? row.phone ?? "—"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-ink-600">{row.roleTitle}</td>
                  <td className="px-4 py-2.5">
                    <Badge>{row.agencyName ?? row.sourceLabel}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge color={row.stageColor}>{row.stageName}</Badge>
                      {row.flagged ? <Badge color="#f59e0b">Flagged</Badge> : null}
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        row.daysInStage >= 14 ? "text-amber-600" : "text-ink-400",
                      )}
                    >
                      {row.daysInStage}d in stage
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                    {formatCurrency(row.expectedCtc)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                    {row.noticePeriodDays !== null ? `${row.noticePeriodDays}d` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-600">{row.ownerName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-500">{formatDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </form>
    </Card>
  );
}
