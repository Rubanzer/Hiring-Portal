"use client";

import { useEffect, useState } from "react";
import { Alert, Button, cn } from "@/components/ui";

/**
 * Renders a resume inside the portal.
 *
 * The whole point is not having to open Drive to read a CV, so this handles the states that
 * would otherwise send you there: a Word file still being converted, a conversion that failed,
 * and a file whose upload never completed. Only the last of those is a dead end, and it says so.
 *
 * The status endpoint reports a conversion in flight, so the component polls rather than
 * showing a broken frame. The poll loop lives entirely inside one effect: driving it from
 * `status` instead would stall, because a second `pending` reply is the same value React
 * already holds, so nothing re-renders and no further tick is ever scheduled.
 */

type Status = "loading" | "ready" | "pending" | "failed" | "missing";

const POLL_MS = 2500;
const MAX_POLLS = 24; // ~1 minute before giving up on a conversion

type Probe =
  | { kind: "ready" }
  | { kind: "pending" }
  | { kind: "missing" | "failed"; error: string | null };

/**
 * A cheap JSON probe rather than the preview itself — polling that would open and discard a
 * Drive stream on every tick. Kept free of component state so the effect below owns every
 * transition and can drop a reply that arrived after you moved on.
 */
async function probePreview(fileId: string): Promise<Probe> {
  try {
    const response = await fetch(`/api/files/${fileId}/preview/status`);
    const data = (await response.json().catch(() => null)) as
      | { status?: string; error?: string }
      | null;

    if (!response.ok) {
      return {
        kind: "failed",
        error:
          response.status === 404
            ? "This resume isn't available to you."
            : (data?.error ?? "This file couldn't be prepared for preview."),
      };
    }

    if (data?.status === "ready") return { kind: "ready" };
    if (data?.status === "pending") return { kind: "pending" };
    if (data?.status === "missing") return { kind: "missing", error: data.error ?? null };

    return { kind: "failed", error: data?.error ?? "This file couldn't be prepared for preview." };
  } catch {
    return { kind: "failed", error: "Couldn't reach the resume. Check your connection and retry." };
  }
}

export function ResumeViewer({
  fileId,
  fileName,
  className,
  height = "70vh",
}: {
  fileId: string | null;
  fileName?: string | null;
  className?: string;
  /** CSS height for the frame. The review screen fills the viewport; detail pages are shorter. */
  height?: string;
}) {
  const [status, setStatus] = useState<Status>(fileId ? "loading" : "missing");
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry. Changing it re-runs the effect, which is the whole retry mechanism.
  const [attempt, setAttempt] = useState(0);

  const previewUrl = fileId ? `/api/files/${fileId}/preview` : null;

  useEffect(() => {
    if (!fileId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (round: number) => {
      if (round === 0) {
        setStatus("loading");
        setError(null);
      }

      const result = await probePreview(fileId);
      // The review queue swaps candidates fast; without this a slow reply for the previous
      // resume would overwrite the state of the one now on screen.
      if (cancelled) return;

      if (result.kind === "pending") {
        // Give up eventually rather than spinning forever on a conversion that's wedged.
        if (round + 1 >= MAX_POLLS) {
          setStatus("failed");
          setError("Converting this file is taking unusually long.");
          return;
        }
        setStatus("pending");
        timer = setTimeout(() => void poll(round + 1), POLL_MS);
        return;
      }

      setStatus(result.kind);
      setError(result.kind === "ready" ? null : result.error);
    };

    // Deferred through a timer rather than called here: it keeps the fetch out of the commit
    // phase, and it is what lets the cleanup below cancel a probe that hasn't started yet.
    timer = setTimeout(() => void poll(0), 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fileId, attempt]);

  if (!fileId) {
    return (
      <Shell className={className} height={height}>
        <p className="text-sm text-ink-500">No resume was attached to this submission.</p>
      </Shell>
    );
  }

  if (status === "loading" || status === "pending") {
    return (
      <Shell className={className} height={height}>
        <div className="text-center">
          <p className="text-sm font-medium text-ink-700">
            {status === "pending" ? "Preparing preview…" : "Loading resume…"}
          </p>
          {status === "pending" ? (
            <p className="mt-1 max-w-sm text-xs text-ink-500">
              Word documents are converted to PDF the first time they&apos;re opened. This
              takes a few seconds, and only happens once.
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (status === "missing" || status === "failed") {
    return (
      <Shell className={className} height={height}>
        <div className="w-full max-w-md space-y-3">
          <Alert tone={status === "missing" ? "warning" : "error"}>
            {error ?? "This resume couldn't be displayed."}
          </Alert>
          {status === "failed" ? (
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </Button>
              <a
                href={`/api/files/${fileId}`}
                className="inline-flex h-8 items-center rounded-lg border border-ink-300 bg-white px-3 text-sm font-medium text-ink-800 hover:bg-ink-100"
              >
                Download original
              </a>
            </div>
          ) : null}
        </div>
      </Shell>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-ink-200 bg-ink-100", className)}>
      <iframe
        src={previewUrl!}
        title={fileName ? `Resume — ${fileName}` : "Resume"}
        className="w-full bg-white"
        style={{ height }}
      />
      <div className="flex items-center justify-between gap-3 border-t border-ink-200 bg-white px-3 py-2">
        <span className="truncate text-xs text-ink-500">{fileName ?? "Resume"}</span>
        <a
          href={`/api/files/${fileId}`}
          className="shrink-0 text-xs font-medium text-ink-700 underline"
        >
          Download original
        </a>
      </div>
    </div>
  );
}

function Shell({
  children,
  className,
  height,
}: {
  children: React.ReactNode;
  className?: string;
  height: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50 p-6",
        className,
      )}
      style={{ minHeight: `min(${height}, 320px)` }}
    >
      {children}
    </div>
  );
}
