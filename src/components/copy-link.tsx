"use client";

import { useEffect, useState } from "react";
import { Button, cn } from "@/components/ui";

/**
 * An invite link with a copy button.
 *
 * Email isn't configured on most deployments of this, so passing the link on by hand is the
 * normal path rather than a fallback — which makes "select this monospace text accurately"
 * something you'd do every time you onboard someone. A missed character produces a link that
 * fails with the same message as an expired one, so the failure isn't even self-explanatory.
 */
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  // Reset the confirmation after a moment. Cleared on unmount so a copy immediately before
  // navigating away doesn't set state on a gone component.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is denied over plain HTTP and in some embedded browsers. Selecting
      // the text is the fallback, and it's already on screen, so there's nothing to report.
    }
  }

  return (
    <div className={cn("flex items-stretch gap-2", className)}>
      <code className="min-w-0 flex-1 truncate rounded border border-ink-200 bg-white px-2 py-1.5 font-mono text-xs text-ink-700">
        {url}
      </code>
      <Button type="button" variant="secondary" size="sm" onClick={copy} className="shrink-0">
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
