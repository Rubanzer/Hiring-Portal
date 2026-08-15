"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  cn,
} from "@/components/ui";
import type { FormState } from "@/components/action-form";
import { KNOCKOUT_OPERATORS, type KnockoutOperator } from "@/lib/screening";

/**
 * Builder for a role's qualifying questions.
 *
 * State lives here and is posted as one JSON blob, so reordering and editing never leave the
 * server holding a half-applied question set. The preview underneath renders the exact form
 * agencies will see — the fastest way to notice a question reads badly is to look at it.
 */

export type QuestionType =
  | "TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "CURRENCY"
  | "BOOLEAN"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "DATE";

export type BuilderQuestion = {
  id: string;
  label: string;
  helpText: string | null;
  type: QuestionType;
  options: string[] | null;
  isRequired: boolean;
  isKnockout: boolean;
  knockoutRule: { op: KnockoutOperator; value?: string | number | boolean | string[] } | null;
  /** Number of submissions already answering this question; drives the delete warning. */
  answerCount?: number;
};

const TYPE_LABELS: Record<QuestionType, string> = {
  TEXT: "Short text",
  LONG_TEXT: "Paragraph",
  NUMBER: "Number",
  CURRENCY: "Currency (₹)",
  BOOLEAN: "Yes / no",
  SINGLE_SELECT: "Choose one",
  MULTI_SELECT: "Choose many",
  DATE: "Date",
};

/** Operators that make sense for each answer type — an "at most" on a paragraph is nonsense. */
const OPERATORS_BY_TYPE: Record<QuestionType, KnockoutOperator[]> = {
  TEXT: ["eq", "neq", "in", "not_in"],
  LONG_TEXT: [],
  NUMBER: ["lte", "gte", "lt", "gt", "eq", "neq"],
  CURRENCY: ["lte", "gte", "lt", "gt"],
  BOOLEAN: ["is_true", "is_false"],
  SINGLE_SELECT: ["in", "not_in", "eq", "neq"],
  MULTI_SELECT: ["in", "not_in"],
  DATE: [],
};

const OPERATOR_LABELS: Record<KnockoutOperator, string> = {
  eq: "must equal",
  neq: "must not equal",
  lt: "must be less than",
  lte: "must be at most",
  gt: "must be more than",
  gte: "must be at least",
  in: "must be one of",
  not_in: "must not be one of",
  is_true: "must be answered yes",
  is_false: "must be answered no",
};

let newIdCounter = 0;
function newQuestion(): BuilderQuestion {
  newIdCounter += 1;
  return {
    id: `new-${newIdCounter}-${Math.random().toString(36).slice(2, 8)}`,
    label: "",
    helpText: null,
    type: "TEXT",
    options: null,
    isRequired: false,
    isKnockout: false,
    knockoutRule: null,
  };
}

function SaveButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : `Save ${count} question${count === 1 ? "" : "s"}`}
    </Button>
  );
}

export function QuestionBuilder({
  roleId,
  initialQuestions,
  action,
}: {
  roleId: string;
  initialQuestions: BuilderQuestion[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [questions, setQuestions] = useState<BuilderQuestion[]>(initialQuestions);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  function update(id: string, patch: Partial<BuilderQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(question: BuilderQuestion) {
    if (question.answerCount && question.answerCount > 0) {
      const ok = window.confirm(
        `"${question.label}" already has ${question.answerCount} answer(s). ` +
          `Removing it deletes those answers permanently. Continue?`,
      );
      if (!ok) return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== question.id));
  }

  function changeType(question: BuilderQuestion, type: QuestionType) {
    const allowed = OPERATORS_BY_TYPE[type];
    update(question.id, {
      type,
      options:
        type === "SINGLE_SELECT" || type === "MULTI_SELECT"
          ? (question.options ?? ["", ""])
          : null,
      // A rule that no longer applies to the new type would silently never fire.
      isKnockout: allowed.length ? question.isKnockout : false,
      knockoutRule:
        question.knockoutRule && allowed.includes(question.knockoutRule.op)
          ? question.knockoutRule
          : allowed.length
            ? { op: allowed[0], value: type === "BOOLEAN" ? undefined : "" }
            : null,
    });
  }

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input type="hidden" name="roleId" value={roleId} />
      <input
        type="hidden"
        name="questions"
        value={JSON.stringify(
          questions.map((q) => ({
            id: q.id,
            label: q.label,
            helpText: q.helpText,
            type: q.type,
            options: q.options?.filter((o) => o.trim()) ?? null,
            isRequired: q.isRequired,
            isKnockout: q.isKnockout,
            knockoutRule: q.isKnockout ? normalizeRule(q) : null,
          })),
        )}
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-300 px-4 py-8 text-center text-sm text-ink-500">
          No questions yet. Agencies will only be asked for name, contact details and a resume.
        </p>
      ) : (
        <ul className="space-y-3">
          {questions.map((question, index) => {
            const operators = OPERATORS_BY_TYPE[question.type];
            const isChoice =
              question.type === "SINGLE_SELECT" || question.type === "MULTI_SELECT";

            return (
              <li
                key={question.id}
                className="rounded-lg border border-ink-200 bg-ink-50/50 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded px-1.5 text-ink-400 hover:bg-ink-200 hover:text-ink-700 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === questions.length - 1}
                      className="rounded px-1.5 text-ink-400 hover:bg-ink-200 hover:text-ink-700 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                      <Field label={`Question ${index + 1}`} required>
                        <Input
                          value={question.label}
                          onChange={(e) => update(question.id, { label: e.target.value })}
                          placeholder="Notice period in days"
                        />
                      </Field>
                      <Field label="Answer type">
                        <Select
                          value={question.type}
                          onChange={(e) =>
                            changeType(question, e.target.value as QuestionType)
                          }
                        >
                          {Object.entries(TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <Field label="Helper text" hint="Shown under the field on the agency form.">
                      <Input
                        value={question.helpText ?? ""}
                        onChange={(e) =>
                          update(question.id, { helpText: e.target.value || null })
                        }
                        placeholder="How soon can they start?"
                      />
                    </Field>

                    {isChoice ? (
                      <Field label="Options" hint="One per line.">
                        <Textarea
                          rows={3}
                          value={(question.options ?? []).join("\n")}
                          onChange={(e) =>
                            update(question.id, { options: e.target.value.split("\n") })
                          }
                          placeholder={"Bengaluru\nMumbai\nRemote"}
                        />
                      </Field>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-ink-700">
                        <input
                          type="checkbox"
                          checked={question.isRequired}
                          onChange={(e) =>
                            update(question.id, { isRequired: e.target.checked })
                          }
                          className="size-4 rounded border-ink-300"
                        />
                        Required
                      </label>

                      {operators.length > 0 ? (
                        <label className="flex items-center gap-2 text-sm text-ink-700">
                          <input
                            type="checkbox"
                            checked={question.isKnockout}
                            onChange={(e) =>
                              update(question.id, {
                                isKnockout: e.target.checked,
                                knockoutRule: e.target.checked
                                  ? (question.knockoutRule ?? {
                                      op: operators[0],
                                      value: question.type === "BOOLEAN" ? undefined : "",
                                    })
                                  : null,
                              })
                            }
                            className="size-4 rounded border-ink-300"
                          />
                          Screening filter
                        </label>
                      ) : null}

                      {question.answerCount ? (
                        <Badge>{question.answerCount} answered</Badge>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => remove(question)}
                        className="ml-auto text-sm font-medium text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>

                    {question.isKnockout && operators.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="mb-2 text-xs font-medium text-amber-900">
                          Flag the candidate when the answer fails this condition. Nothing is
                          auto-rejected — flagged candidates still arrive in Received.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-amber-900">Answer</span>
                          <Select
                            className="h-9 w-auto"
                            value={question.knockoutRule?.op ?? operators[0]}
                            onChange={(e) =>
                              update(question.id, {
                                knockoutRule: {
                                  op: e.target.value as KnockoutOperator,
                                  value: question.knockoutRule?.value,
                                },
                              })
                            }
                          >
                            {operators.map((op) => (
                              <option key={op} value={op}>
                                {OPERATOR_LABELS[op]}
                              </option>
                            ))}
                          </Select>
                          {needsValue(question.knockoutRule?.op ?? operators[0]) ? (
                            <Input
                              className="h-9 w-40"
                              value={String(question.knockoutRule?.value ?? "")}
                              onChange={(e) =>
                                update(question.id, {
                                  knockoutRule: {
                                    op: question.knockoutRule?.op ?? operators[0],
                                    value: e.target.value,
                                  },
                                })
                              }
                              placeholder={
                                question.type === "NUMBER" || question.type === "CURRENCY"
                                  ? "30"
                                  : "Comma-separated"
                              }
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setQuestions((prev) => [...prev, newQuestion()])}
        >
          Add question
        </Button>
        <SaveButton count={questions.length} />
        <p className="text-xs text-ink-500">
          Changes apply to new submissions. Existing answers are kept.
        </p>
      </div>

      {questions.length > 0 ? <Preview questions={questions} /> : null}
    </form>
  );
}

function needsValue(op: KnockoutOperator) {
  return op !== "is_true" && op !== "is_false";
}

/**
 * Converts the builder's loose values (everything is a string in an input) into the typed
 * shape the server validates: numbers for numeric comparisons, arrays for list membership.
 */
function normalizeRule(question: BuilderQuestion) {
  const rule = question.knockoutRule;
  if (!rule) return null;
  if (!KNOCKOUT_OPERATORS.includes(rule.op)) return null;

  if (rule.op === "is_true" || rule.op === "is_false") {
    return { op: rule.op };
  }

  if (rule.op === "in" || rule.op === "not_in") {
    const list = Array.isArray(rule.value)
      ? rule.value
      : String(rule.value ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    return { op: rule.op, value: list };
  }

  if (question.type === "NUMBER" || question.type === "CURRENCY") {
    const num = Number.parseFloat(String(rule.value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(num) ? { op: rule.op, value: num } : null;
  }

  return { op: rule.op, value: String(rule.value ?? "") };
}

/** Renders the questions exactly as an agency will meet them. */
function Preview({ questions }: { questions: BuilderQuestion[] }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">
        What the agency sees
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => (
          <div key={`preview-${q.id}`} className={cn(q.type === "LONG_TEXT" && "sm:col-span-2")}>
            <Field
              label={q.label || "Untitled question"}
              hint={q.helpText ?? undefined}
              required={q.isRequired}
            >
              {q.type === "LONG_TEXT" ? (
                <Textarea rows={2} disabled placeholder="Their answer" />
              ) : q.type === "BOOLEAN" ? (
                <Select disabled>
                  <option>Yes</option>
                </Select>
              ) : q.type === "SINGLE_SELECT" || q.type === "MULTI_SELECT" ? (
                <Select disabled multiple={q.type === "MULTI_SELECT"}>
                  {(q.options ?? []).filter(Boolean).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  disabled
                  type={q.type === "DATE" ? "date" : "text"}
                  placeholder={
                    q.type === "CURRENCY" ? "₹" : q.type === "NUMBER" ? "0" : "Their answer"
                  }
                />
              )}
            </Field>
          </div>
        ))}
      </div>
    </div>
  );
}
