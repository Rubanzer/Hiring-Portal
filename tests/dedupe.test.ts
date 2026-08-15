import { describe, expect, it, vi } from "vitest";
import {
  hasUsableIdentity,
  identityWhere,
  resolveCandidate,
  toIdentity,
} from "../src/lib/dedupe";

/**
 * Candidate resolution decides whether two submissions are the same human. Getting this wrong
 * in one direction pays two agencies for one hire; in the other it makes a returning
 * candidate look brand new.
 */

describe("toIdentity", () => {
  it("normalises name, email and phone together", () => {
    expect(
      toIdentity({
        fullName: "  Rahul   Sharma ",
        email: "Rahul.Sharma@Example.com",
        phone: "098765 43210",
      }),
    ).toEqual({
      fullName: "Rahul Sharma",
      email: "rahul.sharma@example.com",
      phoneE164: "+919876543210",
    });
  });
});

describe("hasUsableIdentity", () => {
  it("requires at least one durable identifier", () => {
    expect(hasUsableIdentity({ fullName: "A", email: "a@b.com", phoneE164: null })).toBe(true);
    expect(hasUsableIdentity({ fullName: "A", email: null, phoneE164: "+91987" })).toBe(true);
    // A name alone can never be recognised again — that record would be an orphan.
    expect(hasUsableIdentity({ fullName: "A", email: null, phoneE164: null })).toBe(false);
  });
});

describe("identityWhere", () => {
  it("only includes identifiers that are present", () => {
    expect(identityWhere({ fullName: "A", email: "a@b.com", phoneE164: null })).toEqual({
      OR: [{ email: "a@b.com" }],
    });

    expect(identityWhere({ fullName: "A", email: "a@b.com", phoneE164: "+9198" })).toEqual({
      OR: [{ email: "a@b.com" }, { phoneE164: "+9198" }],
    });

    // Never produce an empty OR — that would match the first candidate in the table.
    expect(identityWhere({ fullName: "A", email: null, phoneE164: null })).toBeNull();
  });
});

describe("resolveCandidate", () => {
  function mockDb(existing: Record<string, unknown> | null) {
    return {
      candidate: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({ id: "new-candidate" }),
        update: vi.fn().mockResolvedValue({ id: existing?.id ?? "existing" }),
      },
    };
  }

  it("creates a candidate nobody has seen before", async () => {
    const db = mockDb(null);
    const result = await resolveCandidate(db, {
      fullName: "Priya Nair",
      email: "priya@example.com",
      phoneE164: "+919812345678",
    });

    expect(result).toEqual({ candidateId: "new-candidate", created: true });
    expect(db.candidate.create).toHaveBeenCalledOnce();
  });

  it("matches an existing person on either identifier", async () => {
    const db = mockDb({ id: "existing-1", email: "priya@example.com", phoneE164: null });
    const result = await resolveCandidate(db, {
      fullName: "Priya Nair",
      email: "priya@example.com",
      phoneE164: "+919812345678",
    });

    expect(result).toEqual({ candidateId: "existing-1", created: false });
    expect(db.candidate.create).not.toHaveBeenCalled();
  });

  it("fills in a missing identifier but never overwrites one that's already there", async () => {
    const db = mockDb({
      id: "existing-1",
      email: "priya@example.com",
      phoneE164: null,
      currentCompany: "Original Corp",
    });

    await resolveCandidate(db, {
      fullName: "Priya Nair",
      email: "priya@example.com",
      phoneE164: "+919812345678",
      currentCompany: "Stale Data Ltd",
    });

    const update = db.candidate.update.mock.calls[0][0];

    // The blank phone gets filled…
    expect(update.data.phoneE164).toEqual({ set: "+919812345678" });
    // …but the company we already had is left alone.
    expect(update.data.currentCompany).toBeUndefined();
    expect(update.data.email).toBeUndefined();
  });

  it("creates without a lookup when there is no identifier to match on", async () => {
    const db = mockDb(null);
    await resolveCandidate(db, {
      fullName: "No Contact",
      email: null,
      phoneE164: null,
    });

    expect(db.candidate.findFirst).not.toHaveBeenCalled();
    expect(db.candidate.create).toHaveBeenCalledOnce();
  });
});
