import "server-only";
import { prisma } from "./db";
import { listStages, getDefaultStage } from "./funnel";

/**
 * Which stages the Review screen's Shortlist and Reject buttons move a candidate to.
 *
 * Derived from the funnel rather than hardcoded to slugs, because stages are editable from
 * Settings — rename "Shortlisted" or reorder the pipeline and this follows, instead of the
 * review buttons quietly breaking.
 *
 *   Shortlist → the next ACTIVE stage after the entry stage
 *   Reject    → the first LOST stage
 */
export async function reviewTargets() {
  const stages = await listStages();
  const entry = await getDefaultStage();

  const shortlist =
    stages
      .filter((s) => s.kind === "ACTIVE" && s.sortOrder > entry.sortOrder)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  const reject =
    stages.filter((s) => s.kind === "LOST").sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null;

  return { entry, shortlist, reject };
}

export type ReviewCandidate = Awaited<ReturnType<typeof loadReviewQueue>>[number];

/**
 * The queue: everyone sitting in the entry stage, oldest first, so the longest-waiting
 * candidate is dealt with before the one who arrived this morning.
 */
export async function loadReviewQueue(filters: {
  jobRoleId?: string;
  agencyId?: string;
  limit?: number;
}) {
  const entry = await getDefaultStage();

  const applications = await prisma.application.findMany({
    where: {
      currentStageId: entry.id,
      ...(filters.jobRoleId ? { jobRoleId: filters.jobRoleId } : {}),
      ...(filters.agencyId ? { agencyId: filters.agencyId } : {}),
    },
    include: {
      candidate: true,
      jobRole: { select: { id: true, title: true, questions: { orderBy: { sortOrder: "asc" } } } },
      agency: { select: { name: true } },
      resumeFile: { select: { id: true, originalName: true, uploadedAt: true } },
      answers: { include: { question: true } },
    },
    orderBy: { createdAt: "asc" },
    take: filters.limit ?? 50,
  });

  return applications;
}
