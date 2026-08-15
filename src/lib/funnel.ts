import "server-only";
import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type { StageKind } from "@/generated/prisma/enums";

/**
 * Funnel mechanics. `Application.currentStageId` is a cache of the newest StageTransition;
 * the two are only ever written together inside one transaction, so the board can read the
 * cached column without risking a stale view of the history.
 */

export type StageRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  kind: StageKind;
  color: string;
  visibleToAgency: boolean;
  isDefault: boolean;
  isActive: boolean;
};

export async function listStages(): Promise<StageRow[]> {
  return prisma.stage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

/** The stage every new application enters. Falls back to the lowest sort order. */
export async function getDefaultStage(): Promise<StageRow> {
  const stage =
    (await prisma.stage.findFirst({ where: { isDefault: true, isActive: true } })) ??
    (await prisma.stage.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }));

  if (!stage) {
    throw new Error(
      "No funnel stages configured. Run `npm run db:seed` to create the default funnel.",
    );
  }
  return stage;
}

export class StageTransitionError extends Error {}

/**
 * Moves an application to a stage and records why.
 *
 * Both writes happen in one transaction: if the transition row fails, the cached
 * `currentStageId` is not left pointing somewhere the history doesn't justify.
 */
export async function moveApplicationToStage(params: {
  applicationId: string;
  toStageId: string;
  changedByUserId: string;
  reasonCode?: string | null;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { id: params.applicationId },
      select: { id: true, currentStageId: true },
    });
    if (!application) throw new StageTransitionError("Application not found.");

    const toStage = await tx.stage.findUnique({ where: { id: params.toStageId } });
    if (!toStage || !toStage.isActive) {
      throw new StageTransitionError("That stage does not exist or is no longer in use.");
    }

    // Re-recording the same stage would pollute the history with meaningless rows.
    if (application.currentStageId === params.toStageId) {
      return { moved: false as const, stage: toStage };
    }

    await tx.stageTransition.create({
      data: {
        applicationId: application.id,
        fromStageId: application.currentStageId,
        toStageId: params.toStageId,
        changedByUserId: params.changedByUserId,
        reasonCode: params.reasonCode ?? null,
        note: params.note ?? null,
      },
    });

    await tx.application.update({
      where: { id: application.id },
      data: { currentStageId: params.toStageId, stageEnteredAt: new Date() },
    });

    return { moved: true as const, stage: toStage };
  });
}

/** Bulk move, used by the "shortlist 20 at once" action on the funnel table. */
export async function moveManyToStage(params: {
  applicationIds: string[];
  toStageId: string;
  changedByUserId: string;
  reasonCode?: string | null;
}) {
  let moved = 0;
  const errors: string[] = [];

  for (const id of params.applicationIds) {
    try {
      const result = await moveApplicationToStage({
        applicationId: id,
        toStageId: params.toStageId,
        changedByUserId: params.changedByUserId,
        reasonCode: params.reasonCode,
      });
      if (result.moved) moved += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { moved, skipped: params.applicationIds.length - moved, errors };
}

/**
 * Creates the opening transition for a brand new application, so every application's history
 * starts at its entry stage rather than appearing to have materialised there.
 */
export async function recordInitialStage(
  tx: Prisma.TransactionClient,
  params: { applicationId: string; stageId: string; changedByUserId: string | null },
) {
  await tx.stageTransition.create({
    data: {
      applicationId: params.applicationId,
      fromStageId: null,
      toStageId: params.stageId,
      changedByUserId: params.changedByUserId,
      reasonCode: "created",
    },
  });
}

/** How long an application has sat in its current stage, in whole days. */
export function daysInStage(stageEnteredAt: Date): number {
  return Math.floor((Date.now() - stageEnteredAt.getTime()) / 86_400_000);
}

/**
 * Cutoff for "nothing has happened here in N days".
 *
 * Lives here rather than inline in the reports page because reading the clock inside a
 * component body trips React's purity rule — the data layer is the right place for it.
 */
export function stagnantBefore(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** Conversion counts per stage for a role (or across all roles when jobRoleId is omitted). */
export async function funnelCounts(jobRoleId?: string) {
  const grouped = await prisma.application.groupBy({
    by: ["currentStageId"],
    where: jobRoleId ? { jobRoleId } : {},
    _count: { _all: true },
  });

  const stages = await listStages();
  const counts = new Map(grouped.map((g) => [g.currentStageId, g._count._all]));

  return stages.map((stage) => ({
    stage,
    count: counts.get(stage.id) ?? 0,
  }));
}
