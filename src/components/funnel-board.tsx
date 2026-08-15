"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Card, cn, formatCurrency } from "@/components/ui";
import { quickMoveStageAction } from "@/app/(admin)/funnel/actions";

/**
 * Kanban view of the funnel.
 *
 * Cards are moved with native HTML drag-and-drop — no drag library. The board's job is to be
 * readable at 200 candidates and to make "shortlist this one" a single gesture; a dependency
 * that ships its own event system would earn nothing here.
 */

export type BoardCard = {
  id: string;
  candidateName: string;
  roleTitle: string;
  sourceLabel: string;
  agencyName: string | null;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  daysInStage: number;
  flagged: boolean;
  stageId: string;
};

export type BoardColumn = {
  id: string;
  name: string;
  color: string;
  kind: string;
  cards: BoardCard[];
  /** Total in this stage, which can exceed the number of cards loaded. */
  total: number;
};

export function FunnelBoard({ columns }: { columns: BoardColumn[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});

  function move(applicationId: string, toStageId: string, fromStageId: string) {
    if (toStageId === fromStageId) return;

    // Move the card immediately; the server action and revalidate follow.
    setOptimistic((prev) => ({ ...prev, [applicationId]: toStageId }));

    const formData = new FormData();
    formData.set("applicationId", applicationId);
    formData.set("toStageId", toStageId);

    startTransition(async () => {
      await quickMoveStageAction(formData);
      router.refresh();
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[applicationId];
        return next;
      });
    });
  }

  const displayed = columns.map((column) => ({
    ...column,
    cards: columns
      .flatMap((c) => c.cards)
      .filter((card) => (optimistic[card.id] ?? card.stageId) === column.id),
  }));

  return (
    <div
      className={cn(
        "board-scroll flex gap-4 overflow-x-auto pb-4",
        isPending && "opacity-70 transition-opacity",
      )}
    >
      {displayed.map((column) => (
        <div
          key={column.id}
          onDragOver={(e) => {
            e.preventDefault();
            setHoverColumn(column.id);
          }}
          onDragLeave={() => setHoverColumn((prev) => (prev === column.id ? null : prev))}
          onDrop={(e) => {
            e.preventDefault();
            setHoverColumn(null);
            const payload = e.dataTransfer.getData("text/plain");
            const [applicationId, fromStageId] = payload.split("|");
            if (applicationId) move(applicationId, column.id, fromStageId);
          }}
          className={cn(
            "flex w-72 shrink-0 flex-col rounded-xl border border-ink-200 bg-ink-100/60",
            hoverColumn === column.id && "drop-target",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: column.color }}
              />
              <span className="truncate text-sm font-semibold text-ink-800">
                {column.name}
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-ink-600">
              {column.total}
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "70vh" }}>
            {column.cards.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-ink-400">Nothing here</p>
            ) : (
              column.cards.map((card) => (
                <Card
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", `${card.id}|${card.stageId}`);
                    setDraggingId(card.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  className={cn(
                    "cursor-grab p-3 active:cursor-grabbing",
                    draggingId === card.id && "opacity-40",
                  )}
                >
                  <Link href={`/candidates/${card.id}`} className="block">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {card.candidateName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{card.roleTitle}</p>

                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge>{card.agencyName ?? card.sourceLabel}</Badge>
                      {card.flagged ? <Badge color="#f59e0b">Flagged</Badge> : null}
                      {card.noticePeriodDays !== null ? (
                        <Badge>{card.noticePeriodDays}d notice</Badge>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
                      <span>{formatCurrency(card.expectedCtc)}</span>
                      <span
                        className={cn(
                          card.daysInStage >= 14 && column.kind === "ACTIVE" && "text-amber-600",
                        )}
                      >
                        {card.daysInStage === 0 ? "today" : `${card.daysInStage}d here`}
                      </span>
                    </div>
                  </Link>
                </Card>
              ))
            )}

            {column.total > column.cards.length ? (
              <p className="px-2 py-1 text-center text-xs text-ink-400">
                Showing {column.cards.length} of {column.total} — use the table view for the rest
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
