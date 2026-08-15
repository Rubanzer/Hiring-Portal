/**
 * Normalisation rules used everywhere a candidate identity is written or looked up.
 *
 * Deduplication is only as good as the normalisation feeding it, so every entry point —
 * the agency form, the Sheets importer, the seed script — goes through these functions.
 * Nothing else should lowercase an email or strip a phone number by hand.
 */

/** Lowercased and trimmed. Returns null for blank input so it lands as SQL NULL. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  // A bare sanity check — full RFC validation belongs in the zod schema at the edge.
  if (!trimmed.includes("@") || trimmed.startsWith("@") || trimmed.endsWith("@")) {
    return null;
  }
  return trimmed;
}

/**
 * Best-effort E.164. `defaultCountryCode` is applied to local-format numbers, which is the
 * common case for a single-country hiring pipeline (India defaults to +91).
 *
 * Deliberately conservative: anything it can't confidently interpret returns null rather
 * than a wrong number, because a wrong number silently merges two different people.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountryCode = "91",
): string | null {
  if (!input) return null;

  const raw = input.trim();
  if (!raw) return null;

  const hadPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // Strip international dial-out prefixes (00xx / 011xx) before anything else.
  if (!hadPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Indian national trunk prefix: 0 followed by a 10-digit mobile number.
  if (defaultCountryCode === "91" && digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Already carries the country code without a plus (e.g. 919876543210).
  if (digits.startsWith(defaultCountryCode) && digits.length === defaultCountryCode.length + 10) {
    return `+${digits}`;
  }

  // Plain 10-digit local number.
  if (digits.length === 10) {
    return `+${defaultCountryCode}${digits}`;
  }

  // Long enough to be a full international number typed without a plus.
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/** Collapses whitespace and trims. Returns null for blanks. */
export function normalizeName(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** Trimmed text, or null if empty — keeps optional columns as NULL rather than "". */
export function blankToNull(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parses money written the way people actually type it: "12,00,000", "₹8.5 LPA", "12 lakh",
 * "1.2 cr", "45000". Returns whole currency units, or null when it can't tell.
 */
export function parseCurrency(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input) : null;
  }

  const text = input.toLowerCase().trim();
  const numeric = text.replace(/[^0-9.]/g, "");
  if (!numeric) return null;

  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;

  // Unit suffixes are matched against the digits they follow, because a bare \bk\b never
  // matches "45k" — there's no word boundary between a digit and a letter.
  if (/\bcrores?\b|\bcr\b/.test(text)) return Math.round(value * 10_000_000);
  if (/\blpa\b|\blakhs?\b|\blacs?\b|\d\s*l\b/.test(text)) return Math.round(value * 100_000);
  if (/\d\s*k\b/.test(text)) return Math.round(value * 1_000);

  return Math.round(value);
}

/**
 * Parses a notice period into days: "30 days", "2 months", "immediate", "60".
 * Bare numbers are read as days, which matches how these forms are filled in practice.
 */
export function parseNoticePeriodDays(
  input: string | number | null | undefined,
): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input) : null;
  }

  const text = input.toLowerCase().trim();
  // Word-bounded: an unanchored "0 day" would swallow "30 days" and report it as immediate.
  if (/\b(immediate|immediately|asap|available now|serving|none|nil)\b/.test(text)) return 0;

  const numeric = text.replace(/[^0-9.]/g, "");
  if (!numeric) return null;
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;

  if (/month/.test(text)) return Math.round(value * 30);
  if (/week/.test(text)) return Math.round(value * 7);
  return Math.round(value);
}

/** Converts "5 years", "5.5", "66 months" to whole months. */
export function parseExperienceMonths(
  input: string | number | null | undefined,
): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 12) : null;
  }

  const text = input.toLowerCase().trim();
  const numeric = text.replace(/[^0-9.]/g, "");
  if (!numeric) return null;
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;

  if (/month/.test(text)) return Math.round(value);
  return Math.round(value * 12);
}

/** URL-safe slug used for agency portal paths and stage identifiers. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
