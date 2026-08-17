"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResumeViewer } from "@/components/resume-viewer";
import {
  Alert,
  Badge,
  Button,
  Card,
  Textarea,
  cn,
  formatCurrency,
  formatDate,
} from "@/components/ui";
import { decideAction } from "@/app/(admin)/review/actions";

/**
 * Read a resume, decide, move on.
 *
 * Built for a sitting rather than a single candidate: the decision is applied in the
 * background and the queue advances immediately, so a batch of twenty is twenty keystrokes
 * instead of twenty page loads. Keyboard shortcuts do the same thing the buttons do.
 */

export type ReviewItem = {
  applicationId: string;
  candidateName: string;
  email: string | null;
  phone: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  experienceYears: string | null;
  roleTitle: string;
  sourceLabel: string;
  submittedAt: string;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  agencyNotes: string | null;
  resumeFileId: string | null;
  resumeName: string | null;
  flags: string[];
  answers: Array<{ label: string; value: string; flagged: boolean }>;
};

export function ReviewQueue({
  items,
  shortlistLabel,
  rejectLabel,
}: {
  items: ReviewItem[];
  shortlistLabel: string | null;
  rejectLabel: string | null;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /** Ids already acted on this session, so the list doesn't need refetching to stay honest. */
  const [done, setDone] = useState<Set<string>>(new Set());

  const remaining = items.filter((i) => !done.has(i.applicationId));
  const current = remaining[Math.min(index, Math.max(remaining.length - 1, 0))] ?? null;

  const advance = useCallback(() => {
    setNote("");
    setIndex((i) => i + 1);
  }, []);

  const decide = useCallback(
    async (decision: "shortlist" | "reject") => {
      if (!current || busy) return;
      setBusy(true);

      const result = await decideAction({
        applicationId: current.applicationId,
        decision,
        note: note.trim() || undefined,
      });

      setBusy(false);
      setBanner({ tone: result.ok ? "success" : "error", text: result.message });

      if (result.ok) {
        setDone((prev) => new Set(prev).add(current.applicationId));
        setNote("");
        // The list shrinks under us, so the index stays put and lands on the next candidate.
        setIndex((i) => Math.max(0, Math.min(i, remaining.length - 2)));
        router.refresh();
      }
    },
    [current, busy, note, remaining.length, router],
  );

  // Keyboard shortcuts, suppressed while typing a note so "s" doesn't shortlist mid-sentence.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void decide("shortlist");
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void decide("reject");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, advance]);

  if (!current) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-semibold text-ink-800">
          {items.length === 0 ? "Nothing waiting for review" : "You've worked through the queue"}
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {items.length === 0
            ? "New submissions and website leads land here as they arrive."
            : `${done.size} candidate${done.size === 1 ? "" : "s"} decided.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link
            href="/funnel"
            className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-4 text-sm font-medium text-white hover:bg-ink-800"
          >
            Go to the funnel
          </Link>
          {done.size > 0 ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setDone(new Set());
                setIndex(0);
                router.refresh();
              }}
            >
              Reload queue
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-ink-900">{remaining.length}</span> waiting
          {done.size > 0 ? ` · ${done.size} decided this session` : ""}
        </p>
        <p className="hidden text-xs text-ink-400 sm:block">
          <kbd className="rounded border border-ink-300 bg-white px-1">S</kbd> shortlist ·{" "}
          <kbd className="rounded border border-ink-300 bg-white px-1">R</kbd> reject ·{" "}
          <kbd className="rounded border border-ink-300 bg-white px-1">→</kbd> skip
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ResumeViewer
          key={current.applicationId}
          fileId={current.resumeFileId}
          fileName={current.resumeName}
          height="calc(100vh - 300px)"
        />

        <div className="space-y-3">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-ink-900">
                  {current.candidateName}
                </h2>
                <p className="text-sm text-ink-500">
                  {[current.currentTitle, current.currentCompany].filter(Boolean).join(" at ") ||
                    "No current role recorded"}
                </p>
              </div>
              <Badge>{current.sourceLabel}</Badge>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Role" value={current.roleTitle} />
              <Field label="Submitted" value={formatDate(current.submittedAt)} />
              <Field label="Email" value={current.email} />
              <Field label="Phone" value={current.phone} />
              <Field label="Location" value={current.location} />
              <Field label="Experience" value={current.experienceYears} />
              <Field label="Current CTC" value={formatCurrency(current.currentCtc)} />
              <Field label="Expected CTC" value={formatCurrency(current.expectedCtc)} />
              <Field
                label="Notice"
                value={
                  current.noticePeriodDays !== null ? `${current.noticePeriodDays} days` : null
                }
              />
            </dl>

            {current.flags.length > 0 ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-900">
                  Flagged on {current.flags.length} screening question
                  {current.flags.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
                  {current.flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {current.answers.length > 0 ? (
            <Card className="p-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Qualifying answers
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {current.answers.map((answer) => (
                  <div key={answer.label}>
                    <dt className="text-xs text-ink-500">{answer.label}</dt>
                    <dd
                      className={cn(
                        "text-sm",
                        answer.flagged ? "font-medium text-amber-700" : "text-ink-800",
                      )}
                    >
                      {answer.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          {current.agencyNotes ? (
            <Card className="p-5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Notes from the submitter
              </p>
              <p className="whitespace-pre-wrap text-sm text-ink-700">{current.agencyNotes}</p>
            </Card>
          ) : null}

          <Card className="space-y-3 p-5">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note — saved against the candidate with your decision."
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void decide("shortlist")}
                disabled={busy || !shortlistLabel}
                className="flex-1"
              >
                {busy ? "Saving…" : `Shortlist → ${shortlistLabel ?? "not configured"}`}
              </Button>
              <Button
                variant="danger"
                onClick={() => void decide("reject")}
                disabled={busy || !rejectLabel}
                className="flex-1"
              >
                {rejectLabel ? `Reject → ${rejectLabel}` : "Reject not configured"}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={advance} disabled={busy}>
                Skip for now →
              </Button>
              <Link
                href={`/candidates/${current.applicationId}`}
                className="text-sm text-ink-500 underline"
              >
                Open full record
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="truncate text-sm text-ink-800">{value || "—"}</dd>
    </div>
  );
}
