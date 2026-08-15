import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  normalizePhone,
  parseCurrency,
  parseExperienceMonths,
  parseNoticePeriodDays,
  slugify,
} from "../src/lib/normalize";

/**
 * Normalisation is what deduplication rests on: if two spellings of the same phone number
 * normalise differently, the same person becomes two candidates and an agency gets paid twice.
 */

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Rahul.Sharma@Example.COM ")).toBe("rahul.sharma@example.com");
  });

  it("returns null for blanks and malformed values", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("notanemail")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("rahul@")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("treats every common Indian spelling as the same number", () => {
    const expected = "+919876543210";
    for (const input of [
      "9876543210",
      "+91 98765 43210",
      "+91-9876-543210",
      "919876543210",
      "09876543210",
      "0091 9876543210",
      "(+91) 98765 43210",
    ]) {
      expect(normalizePhone(input), `input: ${input}`).toBe(expected);
    }
  });

  it("keeps explicit international numbers intact", () => {
    expect(normalizePhone("+1 415 555 0132")).toBe("+14155550132");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null rather than guessing at unusable input", () => {
    // A wrong guess merges two different people, which is worse than no match at all.
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
  });

  it("honours a different default country code", () => {
    expect(normalizePhone("4155550132", "1")).toBe("+14155550132");
  });
});

describe("parseCurrency", () => {
  it("reads money the way people type it", () => {
    expect(parseCurrency("12,00,000")).toBe(1_200_000);
    expect(parseCurrency("₹8,50,000")).toBe(850_000);
    expect(parseCurrency("18 LPA")).toBe(1_800_000);
    expect(parseCurrency("12 lakh")).toBe(1_200_000);
    expect(parseCurrency("1.2 cr")).toBe(12_000_000);
    expect(parseCurrency("45k")).toBe(45_000);
    expect(parseCurrency(950000)).toBe(950_000);
  });

  it("returns null when there's no number at all", () => {
    expect(parseCurrency("negotiable")).toBeNull();
    expect(parseCurrency("")).toBeNull();
    expect(parseCurrency(null)).toBeNull();
  });
});

describe("parseNoticePeriodDays", () => {
  it("converts the usual phrasings to days", () => {
    expect(parseNoticePeriodDays("30 days")).toBe(30);
    expect(parseNoticePeriodDays("2 months")).toBe(60);
    expect(parseNoticePeriodDays("3 weeks")).toBe(21);
    expect(parseNoticePeriodDays("60")).toBe(60);
    expect(parseNoticePeriodDays(45)).toBe(45);
  });

  it("treats every flavour of 'available now' as zero", () => {
    expect(parseNoticePeriodDays("Immediate")).toBe(0);
    expect(parseNoticePeriodDays("immediate joiner")).toBe(0);
    expect(parseNoticePeriodDays("Available now")).toBe(0);
    expect(parseNoticePeriodDays("serving notice")).toBe(0);
  });
});

describe("parseExperienceMonths", () => {
  it("defaults bare numbers to years", () => {
    expect(parseExperienceMonths("6")).toBe(72);
    expect(parseExperienceMonths("6.5 years")).toBe(78);
    expect(parseExperienceMonths("18 months")).toBe(18);
    expect(parseExperienceMonths(4)).toBe(48);
  });
});

describe("slugify", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Acme Talent Partners")).toBe("acme-talent-partners");
    expect(slugify("  Sales & Marketing!  ")).toBe("sales-marketing");
    expect(slugify("Interviewed — Round 1")).toBe("interviewed-round-1");
  });
});
