import "server-only";
import { prisma } from "./db";

/**
 * The single choke point for agency-side data access.
 *
 * Every read or write performed on behalf of an agency user goes through a function in this
 * file, and each one takes `agencyId` from the session — never from a URL parameter or form
 * field. Nothing under app/(agency) should import `prisma` directly; the ESLint config
 * enforces that, and this module is the sanctioned way around it.
 */

/** Roles this agency is allowed to submit against right now. */
export async function listAgencyRoles(agencyId: string) {
  const assignments = await prisma.agencyJobAssignment.findMany({
    where: {
      agencyId,
      isActive: true,
      jobRole: { status: "OPEN" },
    },
    include: {
      jobRole: {
        include: {
          questions: { orderBy: { sortOrder: "asc" } },
          // Only ever this agency's own submissions, so the count can't leak rival volume.
          _count: { select: { applications: { where: { agencyId } } } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
  });

  return assignments.map((a) => ({
    assignmentId: a.id,
    submissionLimit: a.submissionLimit,
    submittedCount: a.jobRole._count.applications,
    role: a.jobRole,
  }));
}

/** One role, but only if this agency has an active assignment to it. */
export async function getAgencyRole(agencyId: string, jobRoleId: string) {
  const assignment = await prisma.agencyJobAssignment.findUnique({
    where: { agencyId_jobRoleId: { agencyId, jobRoleId } },
    include: {
      jobRole: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
    },
  });

  if (!assignment || !assignment.isActive) return null;
  if (assignment.jobRole.status !== "OPEN") return null;
  return assignment;
}

/**
 * Whether this agency may submit one more candidate for this role.
 * Returns a reason string when it may not, so the UI can explain itself.
 */
export async function checkSubmissionAllowance(agencyId: string, jobRoleId: string) {
  const assignment = await getAgencyRole(agencyId, jobRoleId);
  if (!assignment) {
    return { allowed: false as const, reason: "This role is not open to your agency." };
  }

  if (assignment.submissionLimit === null) {
    return { allowed: true as const, remaining: null };
  }

  const used = await prisma.application.count({ where: { agencyId, jobRoleId } });
  const remaining = assignment.submissionLimit - used;

  if (remaining <= 0) {
    return {
      allowed: false as const,
      reason: `You have reached the submission limit of ${assignment.submissionLimit} for this role.`,
    };
  }

  return { allowed: true as const, remaining };
}

/** This agency's submissions, newest first, with the stage information they're allowed to see. */
export async function listAgencyApplications(
  agencyId: string,
  filters?: { jobRoleId?: string; search?: string },
) {
  return prisma.application.findMany({
    where: {
      agencyId,
      ...(filters?.jobRoleId ? { jobRoleId: filters.jobRoleId } : {}),
      ...(filters?.search
        ? {
            candidate: {
              OR: [
                { fullName: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search.toLowerCase() } },
                { phoneE164: { contains: filters.search } },
              ],
            },
          }
        : {}),
    },
    include: {
      candidate: true,
      jobRole: { select: { id: true, title: true } },
      currentStage: true,
      resumeFile: { select: { id: true, originalName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/**
 * One application, scoped to the agency. Returns null when the id belongs to someone else,
 * which callers turn into a 404 — never a 403, which would confirm the row exists.
 */
export async function getAgencyApplication(agencyId: string, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId, agencyId },
    include: {
      candidate: true,
      jobRole: { select: { id: true, title: true } },
      currentStage: true,
      resumeFile: true,
      answers: { include: { question: true } },
      // Only notes explicitly published to the agency.
      notes: {
        where: { visibility: "SHARED_WITH_AGENCY" },
        orderBy: { createdAt: "desc" },
      },
      transitions: {
        include: { toStage: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

/**
 * Authorisation check for resume downloads: true when the file is attached to at least one
 * application belonging to this agency.
 */
export async function agencyCanAccessFile(agencyId: string, fileId: string) {
  const count = await prisma.application.count({
    where: { agencyId, resumeFileId: fileId },
  });
  return count > 0;
}

/**
 * What an agency is allowed to see about a stage. Stages flagged `visibleToAgency = false`
 * collapse to a generic label so the agency knows the candidate is progressing without
 * learning the internals of the process.
 */
export function agencyVisibleStage(stage: {
  name: string;
  kind: string;
  visibleToAgency: boolean;
  color: string;
}) {
  if (stage.visibleToAgency) return { label: stage.name, color: stage.color };

  switch (stage.kind) {
    case "WON":
      return { label: "Accepted", color: "#16a34a" };
    case "LOST":
      return { label: "Closed", color: "#dc2626" };
    case "HOLD":
      return { label: "On hold", color: "#f59e0b" };
    default:
      return { label: "In process", color: "#64748b" };
  }
}

/** Headline counts for the agency dashboard. */
export async function agencyDashboardStats(agencyId: string) {
  const [total, byKind, recentDuplicates] = await Promise.all([
    prisma.application.count({ where: { agencyId } }),
    prisma.application.groupBy({
      by: ["currentStageId"],
      where: { agencyId },
      _count: { _all: true },
    }),
    prisma.duplicateSubmission.count({ where: { attemptedByAgencyId: agencyId } }),
  ]);

  const stages = await prisma.stage.findMany({ orderBy: { sortOrder: "asc" } });
  const countByStage = new Map(byKind.map((r) => [r.currentStageId, r._count._all]));

  const inProcess = stages
    .filter((s) => s.kind === "ACTIVE")
    .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);
  const won = stages
    .filter((s) => s.kind === "WON")
    .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);
  const lost = stages
    .filter((s) => s.kind === "LOST")
    .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);

  return { total, inProcess, won, lost, recentDuplicates, stages, countByStage };
}
