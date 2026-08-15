import { describe, expect, it } from "vitest";
import { coerceAnswer, failsKnockout, type QuestionDef } from "../src/lib/screening";

/**
 * Knockout rules decide which candidates get a warning badge on the recruiter's screen. A
 * rule that fires when it shouldn't buries good people; one that never fires is dead weight.
 */

function question(overrides: Partial<QuestionDef> = {}): QuestionDef {
  return {
    id: "q1",
    label: "Notice period (days)",
    type: "NUMBER",
    options: null,
    isRequired: false,
    isKnockout: false,
    knockoutRule: null,
    ...overrides,
  };
}

function answer(overrides: Partial<ReturnType<typeof emptyAnswer>> = {}) {
  return { ...emptyAnswer(), ...overrides };
}

function emptyAnswer() {
  return {
    valueText: null as string | null,
    valueNumber: null as number | null,
    valueBool: null as boolean | null,
    valueDate: null as Date | null,
    valueJson: null as string[] | null,
  };
}

describe("coerceAnswer", () => {
  it("routes each type to its typed column", () => {
    expect(coerceAnswer(question({ type: "TEXT" }), " Bengaluru ")).toEqual({
      ok: true,
      value: answer({ valueText: "Bengaluru" }),
    });

    expect(coerceAnswer(question({ type: "NUMBER" }), "45")).toEqual({
      ok: true,
      value: answer({ valueNumber: 45 }),
    });

    expect(coerceAnswer(question({ type: "CURRENCY" }), "₹12,00,000")).toEqual({
      ok: true,
      value: answer({ valueNumber: 1200000 }),
    });

    expect(coerceAnswer(question({ type: "BOOLEAN" }), "yes")).toEqual({
      ok: true,
      value: answer({ valueBool: true }),
    });
  });

  it("rejects a blank answer to a required question", () => {
    const result = coerceAnswer(question({ isRequired: true }), "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("required");
  });

  it("accepts a blank answer to an optional question", () => {
    const result = coerceAnswer(question(), "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.valueNumber).toBeNull();
  });

  it("rejects a choice that isn't on the list", () => {
    const q = question({ type: "SINGLE_SELECT", options: ["Bengaluru", "Mumbai"] });
    expect(coerceAnswer(q, "Chennai").ok).toBe(false);
    expect(coerceAnswer(q, "Mumbai").ok).toBe(true);
  });

  it("stores multi-select answers as an array", () => {
    const q = question({ type: "MULTI_SELECT", options: ["Go", "Rust", "Python"] });
    const result = coerceAnswer(q, ["Go", "Python"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.valueJson).toEqual(["Go", "Python"]);
  });

  it("rejects text where a number is expected", () => {
    expect(coerceAnswer(question({ type: "NUMBER" }), "soon").ok).toBe(false);
  });
});

describe("failsKnockout", () => {
  it("flags only when the acceptable condition is not met", () => {
    // "Notice period must be at most 30 days."
    const q = question({ isKnockout: true, knockoutRule: { op: "lte", value: 30 } });

    expect(failsKnockout(q, answer({ valueNumber: 30 }))).toBe(false);
    expect(failsKnockout(q, answer({ valueNumber: 15 }))).toBe(false);
    expect(failsKnockout(q, answer({ valueNumber: 60 }))).toBe(true);
  });

  it("handles the minimum-experience direction", () => {
    const q = question({
      label: "Years of experience",
      isKnockout: true,
      knockoutRule: { op: "gte", value: 5 },
    });

    expect(failsKnockout(q, answer({ valueNumber: 7 }))).toBe(false);
    expect(failsKnockout(q, answer({ valueNumber: 2 }))).toBe(true);
  });

  it("handles yes/no screeners", () => {
    const q = question({
      type: "BOOLEAN",
      label: "Willing to relocate?",
      isKnockout: true,
      knockoutRule: { op: "is_true" },
    });

    expect(failsKnockout(q, answer({ valueBool: true }))).toBe(false);
    expect(failsKnockout(q, answer({ valueBool: false }))).toBe(true);
  });

  it("handles list membership both ways", () => {
    const inRule = question({
      type: "SINGLE_SELECT",
      isKnockout: true,
      knockoutRule: { op: "in", value: ["Bengaluru", "Mumbai"] },
    });
    expect(failsKnockout(inRule, answer({ valueText: "Mumbai" }))).toBe(false);
    expect(failsKnockout(inRule, answer({ valueText: "Kochi" }))).toBe(true);

    const notInRule = question({
      type: "SINGLE_SELECT",
      isKnockout: true,
      knockoutRule: { op: "not_in", value: ["Competitor Inc"] },
    });
    expect(failsKnockout(notInRule, answer({ valueText: "Competitor Inc" }))).toBe(true);
    expect(failsKnockout(notInRule, answer({ valueText: "Someone Else" }))).toBe(false);
  });

  it("never flags when the question isn't a knockout", () => {
    const q = question({ isKnockout: false, knockoutRule: { op: "lte", value: 30 } });
    expect(failsKnockout(q, answer({ valueNumber: 90 }))).toBe(false);
  });

  it("never flags on a missing answer or a broken rule", () => {
    // A configuration mistake must not silently taint every submission.
    const missingAnswer = question({ isKnockout: true, knockoutRule: { op: "lte", value: 30 } });
    expect(failsKnockout(missingAnswer, answer())).toBe(false);

    const brokenRule = question({ isKnockout: true, knockoutRule: { nonsense: true } });
    expect(failsKnockout(brokenRule, answer({ valueNumber: 90 }))).toBe(false);

    const nullRule = question({ isKnockout: true, knockoutRule: null });
    expect(failsKnockout(nullRule, answer({ valueNumber: 90 }))).toBe(false);
  });
});
