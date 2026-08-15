"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyUser, recordActivity } from "@/lib/auth";
import { checkSubmissionAllowance, getAgencyRole } from "@/lib/tenancy";
import { createSubmission, summarise, type SubmissionResult } from "@/lib/submissions";
import { checkRateLimit } from "@/lib/rate-limit";

export type SubmitState = {
  error?: string;
  results?: SubmissionResult[];
  summary?: ReturnType<typeof summarise>;
};

const candidateSchema = z.object({
  fullName: z.string().min(2).max(160),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  currentCompany: z.string().optional().nullable(),
  currentTitle: z.string().optional().nullable(),
  currentLocation: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  totalExperienceMonths: z.number().nullable().optional(),
  currentCtc: z.string().optional().nullable(),
  expectedCtc: z.string().optional().nullable(),
  noticePeriod: z.string().optional().nullable(),
  resumeFileId: z.string().uuid().optional().nullable(),
  agencyNotes: z.string().max(5000).optional().nullable(),
  answers: z.record(z.string(), z.unknown()).optional(),
});

const payloadSchema = z.object({
  jobRoleId: z.string().uuid(),
  candidates: z.array(candidateSchema).min(1).max(50),
});

/**
 * Handles a whole batch of candidates in one submission.
 *
 * Each candidate is processed independently and its outcome reported separately: a duplicate
 * in row 3 must not discard the six good candidates around it. That partial-success
 * behaviour is the entire point of a bulk form — an all-or-nothing batch would make agencies
 * submit one at a time anyway.
 */
export async function submitCandidatesAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const user = await requireAgencyUser();

  if (!checkRateLimit(`submit:${user.agencyId}`, 40, 60 * 60_000).allowed) {
    return {
      error: "That's a lot of submissions in one hour. Give it a few minutes and try again.",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Couldn't read the form. Reload the page and try again." };
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Some candidate details are missing or invalid. Check each row." };
  }

  const { jobRoleId, candidates } = parsed.data;

  // Re-check access server-side: the role list in the browser could be stale, or forged.
  const assignment = await getAgencyRole(user.agencyId, jobRoleId);
  if (!assignment) {
    return { error: "This role is no longer open to your agency." };
  }

  const allowance = await checkSubmissionAllowance(user.agencyId, jobRoleId);
  if (!allowance.allowed) return { error: allowance.reason };

  if (allowance.remaining !== null && candidates.length > allowance.remaining) {
    return {
      error: `You have ${allowance.remaining} submission${allowance.remaining === 1 ? "" : "s"} left for this role, but sent ${candidates.length}. Remove a few and try again.`,
    };
  }

  const results: SubmissionResult[] = [];
  for (const candidate of candidates) {
    results.push(
      await createSubmission({
        jobRoleId,
        source: "AGENCY",
        agencyId: user.agencyId,
        submittedByUserId: user.id,
        fullName: candidate.fullName,
        email: candidate.email,
        phone: candidate.phone,
        currentCompany: candidate.currentCompany,
        currentTitle: candidate.currentTitle,
        currentLocation: candidate.currentLocation,
        linkedinUrl: candidate.linkedinUrl,
        totalExperienceMonths: candidate.totalExperienceMonths ?? null,
        currentCtc: candidate.currentCtc,
        expectedCtc: candidate.expectedCtc,
        noticePeriod: candidate.noticePeriod,
        resumeFileId: candidate.resumeFileId,
        agencyNotes: candidate.agencyNotes,
        answers: candidate.answers,
      }),
    );
  }

  const summary = summarise(results);

  await recordActivity({
    actorUserId: user.id,
    entityType: "agency",
    entityId: user.agencyId,
    action: "candidates_submitted",
    meta: {
      jobRoleId,
      created: summary.created,
      duplicates: summary.duplicates.length,
      errors: summary.errors.length,
    },
  });

  revalidatePath("/agency");
  revalidatePath("/agency/submissions");

  return { results, summary };
}
