"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  cn,
} from "@/components/ui";
import type { QuestionType } from "@/components/question-builder";
import { submitCandidatesAction, type SubmitState } from "@/app/(agency)/agency/submit/actions";

/**
 * The agency's bulk submission form.
 *
 * Several candidates are entered as repeatable blocks and posted together, but each is
 * accepted or rejected on its own — the result panel reports exactly which rows landed,
 * which were duplicates and which need fixing, so nobody has to re-key six good candidates
 * because the seventh was already in the pipeline.
 */

export type PublicQuestion = {
  id: string;
  label: string;
  helpText: string | null;
  type: QuestionType;
  options: string[] | null;
  isRequired: boolean;
};

type Row = {
  key: string;
  fullName: string;
  email: string;
  phone: string;
  currentCompany: string;
  currentTitle: string;
  currentLocation: string;
  linkedinUrl: string;
  experienceYears: string;
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  agencyNotes: string;
  answers: Record<string, string | string[]>;
  resumeFileId: string | null;
  resumeName: string | null;
  resumeError: string | null;
  uploading: boolean;
};

let rowCounter = 0;
function emptyRow(): Row {
  rowCounter += 1;
  return {
    key: `row-${rowCounter}`,
    fullName: "",
    email: "",
    phone: "",
    currentCompany: "",
    currentTitle: "",
    currentLocation: "",
    linkedinUrl: "",
    experienceYears: "",
    currentCtc: "",
    expectedCtc: "",
    noticePeriod: "",
    agencyNotes: "",
    answers: {},
    resumeFileId: null,
    resumeName: null,
    resumeError: null,
    uploading: false,
  };
}

function SubmitButton({ count, blocked }: { count: number; blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || blocked}>
      {pending
        ? "Submitting…"
        : `Submit ${count} candidate${count === 1 ? "" : "s"}`}
    </Button>
  );
}

export function SubmitCandidatesForm({
  jobRoleId,
  roleTitle,
  questions,
  remaining,
  storageConfigured,
}: {
  jobRoleId: string;
  roleTitle: string;
  questions: PublicQuestion[];
  remaining: number | null;
  storageConfigured: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [state, formAction] = useActionState<SubmitState, FormData>(
    submitCandidatesAction,
    {},
  );

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function setAnswer(key: string, questionId: string, value: string | string[]) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, answers: { ...r.answers, [questionId]: value } } : r,
      ),
    );
  }

  /**
   * Every upload in flight or finished, by row key.
   *
   * Submitting no longer waits for these. The submission goes through without the resume, and
   * the effect below attaches each file to its application the moment it lands — so a slow
   * upload costs the agency nothing.
   */
  const uploads = useRef(new Map<string, Promise<string | null>>());

  /** Uploads straight to Drive, so the file never passes through the app. */
  function uploadResume(key: string, file: File) {
    const promise = runUpload(key, file);
    uploads.current.set(key, promise);
    return promise;
  }

  async function runUpload(key: string, file: File): Promise<string | null> {
    update(key, { uploading: true, resumeError: null, resumeName: file.name });
    try {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });

      const data = (await response.json()) as {
        fileId?: string;
        uploadUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.uploadUrl || !data.fileId) {
        throw new Error(data.error ?? "Upload failed.");
      }

      // Straight to Google. The bytes never touch our server, which is what allows a 25 MB
      // limit despite the platform's 4.5 MB cap on function request bodies.
      const put = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      // The status matters: a CORS refusal shows up here as a bare network failure, and an
      // unnamed "try again" is what made this look like a mystery rather than a fixable fault.
      if (!put.ok) {
        throw new Error(`Google rejected the upload (${put.status}). Try again.`);
      }

      // Ask the server to verify with Drive that the bytes actually landed. Without this an
      // interrupted upload would still look attached, and you'd find out when you opened it.
      const confirmed = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: data.fileId }),
      });
      if (!confirmed.ok) {
        const problem = (await confirmed.json().catch(() => null)) as { error?: string } | null;
        throw new Error(problem?.error ?? "The upload couldn't be verified. Try again.");
      }

      update(key, { resumeFileId: data.fileId, uploading: false });
      return data.fileId;
    } catch (error) {
      update(key, {
        uploading: false,
        resumeFileId: null,
        resumeError: error instanceof Error ? error.message : "Upload failed.",
      });
      return null;
    }
  }

  /**
   * Attaches resumes that were still uploading when the form was submitted.
   *
   * The rows are submitted in order and `results` comes back in that same order, so index i of
   * one lines up with index i of the other. Only rows that went in *without* a resume are
   * considered — anything already attached at submit time needs nothing.
   *
   * A failure here is deliberately quiet on the candidate's record but loud on the row: the
   * application itself was created successfully, and telling someone their submission failed
   * when it didn't would be worse than telling them the resume needs re-adding.
   */
  const attached = useRef(new Set<string>());

  /** The rows exactly as they were sent, so results can be lined up against them afterwards. */
  const [submittedRows, setSubmittedRows] = useState<Row[]>([]);

  useEffect(() => {
    const results = state.results;
    if (!results) return;

    const pending = submittedRows
      .map((row, index) => ({ row, result: results[index] }))
      .filter(
        ({ row, result }) =>
          !row.resumeFileId &&
          uploads.current.has(row.key) &&
          !attached.current.has(row.key) &&
          result?.status === "created",
      );

    if (pending.length === 0) return;

    // Deferred into a callback rather than run in the effect body: the attach sets row state
    // when it finishes, and calling that from the body is what the cascading-render rule
    // exists to prevent.
    const timer = setTimeout(() => {
      for (const { row, result } of pending) {
        attached.current.add(row.key);
        void (async () => {
          const fileId = await uploads.current.get(row.key);
          if (!fileId || result?.status !== "created") return;

          const response = await fetch(`/api/applications/${result.applicationId}/resume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId }),
          }).catch(() => null);

          if (!response?.ok) {
            update(row.key, {
              resumeError: "Submitted, but the resume didn't attach. Add it from My submissions.",
            });
          }
        })();
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [state.results, submittedRows]);


  const anyUploading = rows.some((r) => r.uploading);
  const overLimit = remaining !== null && rows.length > remaining;

  const payload = JSON.stringify({
    jobRoleId,
    candidates: rows.map((row) => ({
      fullName: row.fullName.trim(),
      email: row.email.trim() || null,
      phone: row.phone.trim() || null,
      currentCompany: row.currentCompany.trim() || null,
      currentTitle: row.currentTitle.trim() || null,
      currentLocation: row.currentLocation.trim() || null,
      linkedinUrl: row.linkedinUrl.trim() || null,
      totalExperienceMonths: row.experienceYears.trim()
        ? Math.round(Number.parseFloat(row.experienceYears) * 12)
        : null,
      currentCtc: row.currentCtc.trim() || null,
      expectedCtc: row.expectedCtc.trim() || null,
      noticePeriod: row.noticePeriod.trim() || null,
      resumeFileId: row.resumeFileId,
      agencyNotes: row.agencyNotes.trim() || null,
      answers: row.answers,
    })),
  });

  return (
    <div className="space-y-4">
      {state.summary ? <ResultPanel state={state} /> : null}

      <form
        action={formAction}
        onSubmit={() => setSubmittedRows(rows)}
        className="space-y-4"
      >
        <input type="hidden" name="payload" value={payload} />

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        {!storageConfigured ? (
          <Alert tone="warning" title="Resume upload is unavailable">
            Google Drive isn&apos;t connected on this deployment yet, so resumes can&apos;t be
            attached. You can still submit candidate details — mention where the resume is in
            the notes field.
          </Alert>
        ) : null}

        {overLimit ? (
          <Alert tone="warning">
            You have {remaining} submission{remaining === 1 ? "" : "s"} left for this role but
            have added {rows.length} candidates. Remove a few before submitting.
          </Alert>
        ) : null}

        {rows.map((row, index) => (
          <Card key={row.key} className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-800">
                Candidate {index + 1}
                {row.fullName ? (
                  <span className="ml-2 font-normal text-ink-500">{row.fullName}</span>
                ) : null}
              </h3>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  className="text-sm font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Full name" required>
                <Input
                  value={row.fullName}
                  onChange={(e) => update(row.key, { fullName: e.target.value })}
                  placeholder="Rahul Sharma"
                  required
                />
              </Field>
              <Field label="Email" hint="Email or phone is required.">
                <Input
                  type="email"
                  value={row.email}
                  onChange={(e) => update(row.key, { email: e.target.value })}
                  placeholder="rahul@example.com"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={row.phone}
                  onChange={(e) => update(row.key, { phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </Field>
              <Field label="Current company">
                <Input
                  value={row.currentCompany}
                  onChange={(e) => update(row.key, { currentCompany: e.target.value })}
                />
              </Field>
              <Field label="Current title">
                <Input
                  value={row.currentTitle}
                  onChange={(e) => update(row.key, { currentTitle: e.target.value })}
                />
              </Field>
              <Field label="Location">
                <Input
                  value={row.currentLocation}
                  onChange={(e) => update(row.key, { currentLocation: e.target.value })}
                />
              </Field>
              <Field label="Total experience (years)">
                <Input
                  value={row.experienceYears}
                  onChange={(e) => update(row.key, { experienceYears: e.target.value })}
                  placeholder="6.5"
                />
              </Field>
              <Field label="Current CTC" hint="e.g. 18,00,000 or 18 LPA">
                <Input
                  value={row.currentCtc}
                  onChange={(e) => update(row.key, { currentCtc: e.target.value })}
                />
              </Field>
              <Field label="Expected CTC">
                <Input
                  value={row.expectedCtc}
                  onChange={(e) => update(row.key, { expectedCtc: e.target.value })}
                />
              </Field>
              <Field label="Notice period" hint="e.g. 30 days, 2 months, immediate">
                <Input
                  value={row.noticePeriod}
                  onChange={(e) => update(row.key, { noticePeriod: e.target.value })}
                />
              </Field>
              <Field label="LinkedIn">
                <Input
                  value={row.linkedinUrl}
                  onChange={(e) => update(row.key, { linkedinUrl: e.target.value })}
                  placeholder="https://linkedin.com/in/…"
                />
              </Field>
              <Field
                label="Resume"
                hint={
                  storageConfigured
                    ? "PDF, DOC or DOCX, up to 25 MB."
                    : "Unavailable right now."
                }
                error={row.resumeError}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={!storageConfigured || row.uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadResume(row.key, file);
                  }}
                  className="w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-ink-800 disabled:opacity-50"
                />
                {row.uploading ? (
                  <p className="mt-1 text-xs text-ink-500">Uploading {row.resumeName}…</p>
                ) : row.resumeFileId ? (
                  <p className="mt-1 text-xs font-medium text-green-700">
                    ✓ {row.resumeName} attached
                  </p>
                ) : null}
              </Field>
            </div>

            {questions.length > 0 ? (
              <div className="mt-5 border-t border-ink-200 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Qualifying questions for {roleTitle}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {questions.map((question) => (
                    <div
                      key={question.id}
                      className={cn(question.type === "LONG_TEXT" && "sm:col-span-2")}
                    >
                      <QuestionField
                        question={question}
                        value={row.answers[question.id]}
                        onChange={(value) => setAnswer(row.key, question.id, value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <Field
                label="Your notes on this candidate"
                hint="Your pitch or context — visible to the hiring team, not to the candidate."
              >
                <Textarea
                  rows={2}
                  value={row.agencyNotes}
                  onChange={(e) => update(row.key, { agencyNotes: e.target.value })}
                  placeholder="Strong fit on the payments side; open to relocating; available for a call this week."
                />
              </Field>
            </div>
          </Card>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            Add another candidate
          </Button>
          <SubmitButton count={rows.length} blocked={overLimit} />
          {anyUploading ? (
            <span className="text-sm text-ink-500">
              Resumes still uploading — you can submit now, they&apos;ll attach themselves.
            </span>
          ) : null}
          {remaining !== null ? (
            <Badge>{remaining} submission{remaining === 1 ? "" : "s"} left</Badge>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: PublicQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const options = question.options ?? [];

  return (
    <Field
      label={question.label}
      hint={question.helpText ?? undefined}
      required={question.isRequired}
    >
      {question.type === "LONG_TEXT" ? (
        <Textarea
          rows={2}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : question.type === "BOOLEAN" ? (
        <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      ) : question.type === "SINGLE_SELECT" ? (
        <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : question.type === "MULTI_SELECT" ? (
        <select
          multiple
          value={(value as string[]) ?? []}
          onChange={(e) =>
            onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
          }
          className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={question.type === "DATE" ? "date" : "text"}
          inputMode={
            question.type === "NUMBER" || question.type === "CURRENCY" ? "numeric" : undefined
          }
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Per-row outcome, so a partial batch is legible at a glance. */
function ResultPanel({ state }: { state: SubmitState }) {
  const summary = state.summary!;
  const results = state.results ?? [];

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-ink-900">
        {summary.created} of {summary.total} candidate{summary.total === 1 ? "" : "s"} submitted
      </h3>

      <div className="mt-3 space-y-2">
        {results.map((result, index) => (
          <div
            key={`${result.candidateName}-${index}`}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              result.status === "created" && "border-green-200 bg-green-50 text-green-900",
              result.status === "duplicate" && "border-amber-200 bg-amber-50 text-amber-900",
              result.status === "error" && "border-red-200 bg-red-50 text-red-900",
            )}
          >
            <span className="font-medium">{result.candidateName}</span>
            {result.status === "created" ? (
              <>
                {" — submitted"}
                {result.knockoutFlags.length > 0 ? (
                  <span className="ml-1 text-amber-800">
                    (flagged on {result.knockoutFlags.length} screening question
                    {result.knockoutFlags.length === 1 ? "" : "s"})
                  </span>
                ) : null}
              </>
            ) : (
              <> — {result.message}</>
            )}
          </div>
        ))}
      </div>

      {summary.created > 0 ? (
        <p className="mt-3 text-sm text-ink-500">
          Submitted candidates now appear under{" "}
          <Link href="/agency/submissions" className="underline">
            My submissions
          </Link>
          , where you can follow their progress.
        </p>
      ) : null}
    </Card>
  );
}
