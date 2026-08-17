import type { Prisma } from "@/generated/prisma/client";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Candidate identity resolution.
 *
 * A person is matched on normalised email OR normalised phone. Name is deliberately not used
 * for matching — "Rahul Sharma" is not an identity, and merging two of them is far more
 * damaging than creating a duplicate row.
 *
 * The functions here are pure so they can be unit-tested without a database; the transaction
 * client is passed in by the caller.
 */

export type CandidateIdentity = {
  fullName: string;
  email: string | null;
  phoneE164: string | null;
};

export type CandidateInput = CandidateIdentity & {
  currentCompany?: string | null;
  currentTitle?: string | null;
  totalExperienceMonths?: number | null;
  currentLocation?: string | null;
  linkedinUrl?: string | null;
};

/** Normalises whatever the agency form or the careers page supplied into a comparable identity. */
export function toIdentity(input: {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}): CandidateIdentity {
  return {
    fullName: input.fullName.replace(/\s+/g, " ").trim(),
    email: normalizeEmail(input.email),
    phoneE164: normalizePhone(input.phone),
  };
}

/**
 * A candidate needs at least one durable identifier. Without an email or a phone there is no
 * way to recognise the same person next time, and the record becomes an orphan.
 */
export function hasUsableIdentity(identity: CandidateIdentity): boolean {
  return Boolean(identity.email || identity.phoneE164);
}

/** The OR clause used to find an existing person. Empty identifiers are never included. */
export function identityWhere(identity: CandidateIdentity): Prisma.CandidateWhereInput | null {
  const or: Prisma.CandidateWhereInput[] = [];
  if (identity.email) or.push({ email: identity.email });
  if (identity.phoneE164) or.push({ phoneE164: identity.phoneE164 });
  return or.length ? { OR: or } : null;
}

type CandidateDelegate = {
  findFirst: (args: { where: Prisma.CandidateWhereInput }) => Promise<{ id: string } | null>;
  create: (args: { data: Prisma.CandidateCreateInput }) => Promise<{ id: string }>;
  update: (args: {
    where: { id: string };
    data: Prisma.CandidateUpdateInput;
  }) => Promise<{ id: string }>;
};

export type ResolveResult = {
  candidateId: string;
  /** True when this person had never been seen before, in any role. */
  created: boolean;
};

/**
 * Finds the existing person or creates them, then backfills any profile field that was blank.
 *
 * Backfill is additive only: an existing non-null value is never overwritten by a later
 * submission, because the first record of a person is usually the one you verified, and an
 * agency re-submitting stale details should not be able to degrade it.
 */
export async function resolveCandidate(
  db: { candidate: CandidateDelegate },
  input: CandidateInput,
): Promise<ResolveResult> {
  const where = identityWhere(input);

  if (where) {
    const existing = await db.candidate.findFirst({ where });
    if (existing) {
      const backfill: Prisma.CandidateUpdateInput = {};
      // Add the identifier this submission carried if the record was missing it.
      if (input.email) backfill.email = { set: input.email };
      if (input.phoneE164) backfill.phoneE164 = { set: input.phoneE164 };
      if (input.currentCompany) backfill.currentCompany = { set: input.currentCompany };
      if (input.currentTitle) backfill.currentTitle = { set: input.currentTitle };
      if (input.currentLocation) backfill.currentLocation = { set: input.currentLocation };
      if (input.linkedinUrl) backfill.linkedinUrl = { set: input.linkedinUrl };
      if (input.totalExperienceMonths != null) {
        backfill.totalExperienceMonths = { set: input.totalExperienceMonths };
      }

      await db.candidate.update({
        where: { id: existing.id },
        data: onlyMissing(backfill, existing),
      });

      return { candidateId: existing.id, created: false };
    }
  }

  const created = await db.candidate.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phoneE164: input.phoneE164,
      currentCompany: input.currentCompany ?? null,
      currentTitle: input.currentTitle ?? null,
      totalExperienceMonths: input.totalExperienceMonths ?? null,
      currentLocation: input.currentLocation ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
    },
  });

  return { candidateId: created.id, created: true };
}

/**
 * Strips update fields whose value is already present on the existing row, so we only ever
 * fill gaps. Written against a loose record type because the caller may pass a partial
 * select — the guard is "is the existing value falsy", nothing more.
 */
function onlyMissing(
  update: Prisma.CandidateUpdateInput,
  existing: Record<string, unknown>,
): Prisma.CandidateUpdateInput {
  const result: Prisma.CandidateUpdateInput = {};
  for (const [key, value] of Object.entries(update)) {
    const current = existing[key];
    if (current === undefined || current === null || current === "") {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/** Human-readable explanation for a blocked duplicate, shown to the submitting agency. */
export function duplicateMessage(params: {
  candidateName: string;
  ownedByThisAgency: boolean;
  ownedByAnotherAgency: boolean;
  source: string;
}): string {
  if (params.ownedByThisAgency) {
    return `${params.candidateName} has already been submitted by your agency for this role.`;
  }
  if (params.ownedByAnotherAgency) {
    return `${params.candidateName} is already in the pipeline for this role through another source. Your submission has been logged against the ownership record.`;
  }
  if (params.source === "WEBSITE") {
    return `${params.candidateName} already applied directly through the website for this role.`;
  }
  return `${params.candidateName} is already in the pipeline for this role.`;
}
