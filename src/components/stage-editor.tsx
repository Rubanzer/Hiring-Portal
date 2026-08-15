"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Input, Select, cn } from "@/components/ui";
import { SubmitButton, type FormState } from "@/components/action-form";

/**
 * Editor for the funnel itself.
 *
 * Stages are data, so renaming "Called" to "Screened" or inserting a fourth interview round
 * is a two-minute change here rather than a migration. Removing a stage deactivates it —
 * candidates already in it keep their history and are shown in the timeline.
 */

export type EditableStage = {
  id: string;
  name: string;
  kind: "ACTIVE" | "WON" | "LOST" | "HOLD";
  color: string;
  visibleToAgency: boolean;
  isDefault: boolean;
  applicationCount: number;
};

const KIND_LABELS = {
  ACTIVE: "Active — a column on the board",
  WON: "Won — accepted / hired",
  LOST: "Lost — out of the process",
  HOLD: "Hold — parked, revivable",
} as const;

let counter = 0;

export function StageEditor({
  initialStages,
  action,
}: {
  initialStages: EditableStage[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [stages, setStages] = useState<EditableStage[]>(initialStages);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  function update(id: string, patch: Partial<EditableStage>) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    setStages((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setDefault(id: string) {
    setStages((prev) => prev.map((s) => ({ ...s, isDefault: s.id === id })));
  }

  function remove(stage: EditableStage) {
    if (stage.applicationCount > 0) {
      const ok = window.confirm(
        `${stage.applicationCount} candidate(s) are currently in "${stage.name}". ` +
          `Removing it hides the stage from the board — those candidates stay where they are ` +
          `and you'll need to move them manually. Continue?`,
      );
      if (!ok) return;
    }
    setStages((prev) => prev.filter((s) => s.id !== stage.id));
  }

  function add() {
    counter += 1;
    setStages((prev) => [
      ...prev,
      {
        id: `new-${counter}`,
        name: "",
        kind: "ACTIVE",
        color: "#64748b",
        visibleToAgency: true,
        isDefault: false,
        applicationCount: 0,
      },
    ]);
  }

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input
        type="hidden"
        name="stages"
        value={JSON.stringify(
          stages.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            color: s.color,
            visibleToAgency: s.visibleToAgency,
            isDefault: s.isDefault,
          })),
        )}
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <ul className="space-y-2">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-ink-50/50 p-3"
          >
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="rounded px-1 text-ink-400 hover:bg-ink-200 disabled:opacity-30"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === stages.length - 1}
                className="rounded px-1 text-ink-400 hover:bg-ink-200 disabled:opacity-30"
                aria-label="Move down"
              >
                ↓
              </button>
            </div>

            <input
              type="color"
              value={stage.color}
              onChange={(e) => update(stage.id, { color: e.target.value })}
              className="size-9 shrink-0 cursor-pointer rounded border border-ink-300"
              aria-label={`Colour for ${stage.name}`}
            />

            <Input
              value={stage.name}
              onChange={(e) => update(stage.id, { name: e.target.value })}
              placeholder="Stage name"
              className="w-56"
            />

            <Select
              value={stage.kind}
              onChange={(e) =>
                update(stage.id, { kind: e.target.value as EditableStage["kind"] })
              }
              className="w-64"
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="radio"
                name="default-stage"
                checked={stage.isDefault}
                onChange={() => setDefault(stage.id)}
                className="size-4"
              />
              Entry stage
            </label>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={stage.visibleToAgency}
                onChange={(e) => update(stage.id, { visibleToAgency: e.target.checked })}
                className="size-4 rounded border-ink-300"
              />
              Agencies see this name
            </label>

            <span
              className={cn(
                "ml-auto text-xs tabular-nums",
                stage.applicationCount > 0 ? "text-ink-600" : "text-ink-400",
              )}
            >
              {stage.applicationCount} here
            </span>

            <button
              type="button"
              onClick={() => remove(stage)}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
        <Button type="button" variant="secondary" onClick={add}>
          Add stage
        </Button>
        <SubmitButton pendingLabel="Saving…">Save funnel</SubmitButton>
        <p className="text-xs text-ink-500">
          Stages you remove are hidden from the board but kept in candidate history.
        </p>
      </div>
    </form>
  );
}
