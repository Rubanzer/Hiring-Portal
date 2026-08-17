import "server-only";
import { prisma } from "./db";
import { getDefaultStage, recordInitialStage } from "./funnel";
import { resolveCandidate, toIdentity, hasUsableIdentity, duplicateMessage } from "./dedupe";
import {
  coerceAnswer,
  failsKnockout,
  type AnswerValue,
  type QuestionDef,
} from "./screening";
import { blankToNull, parseCurrency, parseNoticePeriodDays } from "./normalize";
import type { ApplicationSource } from "@/generated/prisma/enums";

/**
 * One code path for creating an application, whether an agency filled in the portal form or
 * someone applied on your careers page.
 *
 * Everything that decides ownership, deduplication and screening lives here, so a public
 * application can never accidentally follow different rules from an agency one.
 */

export type SubmissionInput = {
  jobRoleId: string;
  source: ApplicationSource;
  agencyId?: string | null;
  submittedByUserId?: string | null;

  fullName: string;
  email?: string | null;
  phone?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  currentLocation?: string | null;
  linkedinUrl?: string | null;
  totalExperienceMonths?: number | null;

  currentCtc?: string | number | null;
  expectedCtc?: string | number | null;
  noticePeriod?: string | number | null;

  resumeFileId?: string | null;
  agencyNotes?: string | null;

  /** Screening answers keyed by question id. */
  answers?: Record<string, unknown>;
};

export type SubmissionResult =
  | {
      status: "created";
      applicationId: string;
      candidateId: string;
      candidateName: string;
      knockoutFlags: string[];
      newCandidate: boolean;
    }
  | {
      status: "duplicate";
      candidateName: string;
      message: string;
      existingApplicationId: string | null;
    }
  | { status: "error"; candidateName: string; message: string };

/**
 * Creates one application.
 *
 * The whole thing runs in a transaction so a submission is either fully recorded — candidate,
 * application, answers, opening stage transition — or not recorded at all. A half-written
 * application would sit in the funnel with no history and no answers, which is worse than a
 * rejected submission.
 */
export async function createSubmission(
  input: SubmissionInput,
): Promise<SubmissionResult> {
  const identity = toIdentity({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
  });

  if (!identity.fullName) {
    return { status: "error", candidateName: "Unnamed", message: "A candidate name is required." };
  }
  if (!hasUsableIdentity(identity)) {
    return {
      status: "error",
      candidateName: identity.fullName,
      message: "An email address or phone number is required so the candidate can be identified.",
    };
  }

  const role = await prisma.jobRole.findUnique({
    where: { id: input.jobRoleId },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });
  if (!role) {
    return { status: "error", candidateName: identity.fullName, message: "That role no longer exists." };
  }

  // Validate and type every answer before opening the transaction — a rejected answer should
  // not have created a candidate row on the way to failing.
  const preparedAnswers: Array<{ questionId: string; value: AnswerValue }> = [];
  const knockoutFlags: string[] = [];

  for (const question of role.questions) {
    const def: QuestionDef = {
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options,
      isRequired: question.isRequired,
      isKnockout: question.isKnockout,
      knockoutRule: question.knockoutRule,
    };

    const result = coerceAnswer(def, input.answers?.[question.id]);
    if (!result.ok) {
      return { status: "error", candidateName: identity.fullName, message: result.error };
    }

    preparedAnswers.push({ questionId: question.id, value: result.value });
    if (failsKnockout(def, result.value)) knockoutFlags.push(question.id);
  }

  const defaultStage = await getDefaultStage();

  const agency = input.agencyId
    ? await prisma.agency.findUnique({ where: { id: input.agencyId } })
    : null;

  const ownershipExpiresAt = agency
    ? new Date(Date.now() + agency.ownershipWindowDays * 86_400_000)
    : null;

  try {
    return await prisma.$transaction(async (tx) => {
      const { candidateId, created } = await resolveCandidate(tx, {
        fullName: identity.fullName,
        email: identity.email,
        phoneE164: identity.phoneE164,
        currentCompany: blankToNull(input.currentCompany),
        currentTitle: blankToNull(input.currentTitle),
        currentLocation: blankToNull(input.currentLocation),
        linkedinUrl: blankToNull(input.linkedinUrl),
        totalExperienceMonths: input.totalExperienceMonths ?? null,
      });

      // The unique constraint on (candidateId, jobRoleId) is the real guard; this lookup only
      // exists to produce a useful message and an ownership record.
      const existing = await tx.application.findUnique({
        where: { candidateId_jobRoleId: { candidateId, jobRoleId: input.jobRoleId } },
        include: { agency: { select: { id: true, name: true } } },
      });

      if (existing) {
        await tx.duplicateSubmission.create({
          data: {
            candidateId,
            jobRoleId: input.jobRoleId,
            attemptedByAgencyId: input.agencyId ?? null,
            attemptedByUserId: input.submittedByUserId ?? null,
            existingApplicationId: existing.id,
            existingAgencyId: existing.agencyId,
          },
        });

        return {
          status: "duplicate" as const,
          candidateName: identity.fullName,
          existingApplicationId: existing.id,
          message: duplicateMessage({
            candidateName: identity.fullName,
            ownedByThisAgency: Boolean(input.agencyId && existing.agencyId === input.agencyId),
            ownedByAnotherAgency: Boolean(
              existing.agencyId && existing.agencyId !== input.agencyId,
            ),
            source: existing.source,
          }),
        };
      }

      const application = await tx.application.create({
        data: {
          candidateId,
          jobRoleId: input.jobRoleId,
          source: input.source,
          agencyId: input.agencyId ?? null,
          submittedByUserId: input.submittedByUserId ?? null,
          currentStageId: defaultStage.id,
          resumeFileId: input.resumeFileId ?? null,
          agencyNotes: blankToNull(input.agencyNotes),
          currentCtc: parseCurrency(input.currentCtc ?? null),
          expectedCtc: parseCurrency(input.expectedCtc ?? null),
          noticePeriodDays: parseNoticePeriodDays(input.noticePeriod ?? null),
          knockoutFlags: knockoutFlags.length ? (knockoutFlags as never) : undefined,
          ownershipExpiresAt,
        },
      });

      if (preparedAnswers.length) {
        await tx.applicationAnswer.createMany({
          data: preparedAnswers.map((a) => ({
            applicationId: application.id,
            questionId: a.questionId,
            valueText: a.value.valueText,
            valueNumber: a.value.valueNumber,
            valueBool: a.value.valueBool,
            valueDate: a.value.valueDate,
            // Prisma distinguishes "JSON null" from "no value"; undefined leaves the column NULL.
            valueJson: a.value.valueJson ?? undefined,
          })),
        });
      }

      await recordInitialStage(tx, {
        applicationId: application.id,
        stageId: defaultStage.id,
        changedByUserId: input.submittedByUserId ?? null,
      });

      return {
        status: "created" as const,
        applicationId: application.id,
        candidateId,
        candidateName: identity.fullName,
        knockoutFlags,
        newCandidate: created,
      };
    });
  } catch (error) {
    // A concurrent submission of the same person can still lose the race to the unique index.
    if (isUniqueViolation(error)) {
      return {
        status: "duplicate",
        candidateName: identity.fullName,
        existingApplicationId: null,
        message: `${identity.fullName} is already in the pipeline for this role.`,
      };
    }
    return {
      status: "error",
      candidateName: identity.fullName,
      message: error instanceof Error ? error.message : "Something went wrong saving this candidate.",
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/** Aggregate outcome of a batch, used to summarise a multi-candidate submission. */
export function summarise(results: SubmissionResult[]) {
  const created = results.filter((r) => r.status === "created").length;
  const duplicates = results.filter((r) => r.status === "duplicate");
  const errors = results.filter((r) => r.status === "error");
  const flagged = results.filter(
    (r) => r.status === "created" && r.knockoutFlags.length > 0,
  ).length;

  return { created, duplicates, errors, flagged, total: results.length };
}
