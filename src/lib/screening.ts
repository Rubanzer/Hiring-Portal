import { z } from "zod";
import type { QuestionType } from "@/generated/prisma/enums";

/**
 * Screening questions: how an answer is validated, stored and knocked out.
 *
 * Knockout rules flag a submission, they never reject it. An agency's candidate who fails a
 * hard filter still lands in Received with a visible flag, because the judgement call about
 * a borderline candidate is yours, not the form's.
 */

export const KNOCKOUT_OPERATORS = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "not_in",
  "is_true",
  "is_false",
] as const;

export type KnockoutOperator = (typeof KNOCKOUT_OPERATORS)[number];

export const knockoutRuleSchema = z.object({
  op: z.enum(KNOCKOUT_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});

export type KnockoutRule = z.infer<typeof knockoutRuleSchema>;

export type QuestionDef = {
  id: string;
  label: string;
  type: QuestionType;
  options: unknown;
  isRequired: boolean;
  isKnockout: boolean;
  knockoutRule: unknown;
};

/** The typed column an answer of this type is written to. */
export type AnswerValue = {
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  valueDate: Date | null;
  valueJson: string[] | null;
};

const EMPTY_ANSWER: AnswerValue = {
  valueText: null,
  valueNumber: null,
  valueBool: null,
  valueDate: null,
  valueJson: null,
};

export function parseOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.filter((o): o is string => typeof o === "string");
}

/**
 * Coerces a raw form value into the right typed column, or returns an error message.
 * Blank values on an optional question yield an empty answer rather than an error.
 */
export function coerceAnswer(
  question: QuestionDef,
  raw: unknown,
): { ok: true; value: AnswerValue } | { ok: false; error: string } {
  const isBlank =
    raw === undefined ||
    raw === null ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0);

  if (isBlank) {
    if (question.isRequired) {
      return { ok: false, error: `${question.label} is required.` };
    }
    return { ok: true, value: { ...EMPTY_ANSWER } };
  }

  switch (question.type) {
    case "TEXT":
    case "LONG_TEXT": {
      const text = String(raw).trim();
      if (text.length > 5000) {
        return { ok: false, error: `${question.label} is too long (max 5000 characters).` };
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueText: text } };
    }

    case "NUMBER":
    case "CURRENCY": {
      const num =
        typeof raw === "number" ? raw : Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(num)) {
        return { ok: false, error: `${question.label} must be a number.` };
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueNumber: Math.round(num) } };
    }

    case "BOOLEAN": {
      const text = String(raw).toLowerCase();
      const truthy = ["true", "yes", "y", "1", "on"].includes(text);
      const falsy = ["false", "no", "n", "0", "off"].includes(text);
      if (!truthy && !falsy) {
        return { ok: false, error: `${question.label} must be yes or no.` };
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueBool: truthy } };
    }

    case "SINGLE_SELECT": {
      const text = String(raw).trim();
      const allowed = parseOptions(question.options);
      if (allowed.length && !allowed.includes(text)) {
        return { ok: false, error: `${question.label}: "${text}" is not one of the options.` };
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueText: text } };
    }

    case "MULTI_SELECT": {
      const values = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim());
      const allowed = parseOptions(question.options);
      if (allowed.length) {
        const invalid = values.filter((v) => !allowed.includes(v));
        if (invalid.length) {
          return {
            ok: false,
            error: `${question.label}: ${invalid.join(", ")} not among the options.`,
          };
        }
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueJson: values } };
    }

    case "DATE": {
      const date = new Date(String(raw));
      if (Number.isNaN(date.getTime())) {
        return { ok: false, error: `${question.label} must be a valid date.` };
      }
      return { ok: true, value: { ...EMPTY_ANSWER, valueDate: date } };
    }

    default:
      return { ok: false, error: `${question.label} has an unsupported question type.` };
  }
}

/**
 * Evaluates a knockout rule. Returns true when the answer FAILS the rule, i.e. the candidate
 * should be flagged.
 *
 * An unparseable rule or a missing answer never flags: a configuration mistake must not
 * silently taint every submission.
 */
export function failsKnockout(question: QuestionDef, answer: AnswerValue): boolean {
  if (!question.isKnockout) return false;

  const parsed = knockoutRuleSchema.safeParse(question.knockoutRule);
  if (!parsed.success) return false;
  const { op, value } = parsed.data;

  const num = answer.valueNumber;
  const bool = answer.valueBool;
  const text = answer.valueText;
  const list = answer.valueJson;

  switch (op) {
    case "is_true":
      return bool === false;
    case "is_false":
      return bool === true;

    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      if (num === null || typeof value !== "number") return false;
      // The rule states the ACCEPTABLE condition; failing it is what we flag.
      const passes =
        op === "lt" ? num < value
        : op === "lte" ? num <= value
        : op === "gt" ? num > value
        : num >= value;
      return !passes;
    }

    case "eq": {
      if (num !== null && typeof value === "number") return num !== value;
      if (text !== null) return text !== String(value);
      if (bool !== null && typeof value === "boolean") return bool !== value;
      return false;
    }

    case "neq": {
      if (num !== null && typeof value === "number") return num === value;
      if (text !== null) return text === String(value);
      if (bool !== null && typeof value === "boolean") return bool === value;
      return false;
    }

    case "in": {
      if (!Array.isArray(value)) return false;
      if (text !== null) return !value.includes(text);
      if (list !== null) return !list.some((v) => value.includes(v));
      return false;
    }

    case "not_in": {
      if (!Array.isArray(value)) return false;
      if (text !== null) return value.includes(text);
      if (list !== null) return list.some((v) => value.includes(v));
      return false;
    }

    default:
      return false;
  }
}

/** Plain-English rendering of a rule, for the question builder and the candidate detail view. */
export function describeKnockout(question: QuestionDef): string | null {
  if (!question.isKnockout) return null;
  const parsed = knockoutRuleSchema.safeParse(question.knockoutRule);
  if (!parsed.success) return null;
  const { op, value } = parsed.data;

  const shown = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  switch (op) {
    case "lt":
      return `Flag unless less than ${shown}`;
    case "lte":
      return `Flag unless at most ${shown}`;
    case "gt":
      return `Flag unless more than ${shown}`;
    case "gte":
      return `Flag unless at least ${shown}`;
    case "eq":
      return `Flag unless equal to ${shown}`;
    case "neq":
      return `Flag if equal to ${shown}`;
    case "in":
      return `Flag unless one of: ${shown}`;
    case "not_in":
      return `Flag if one of: ${shown}`;
    case "is_true":
      return "Flag if answered no";
    case "is_false":
      return "Flag if answered yes";
    default:
      return null;
  }
}

/**
 * Renders a stored answer back to a readable string for tables and detail views.
 *
 * Takes the row shape loosely because `valueJson` arrives from Prisma as an untyped
 * JsonValue; narrowing happens here rather than at every call site.
 */
export function formatAnswer(
  type: QuestionType,
  answer: {
    valueText?: string | null;
    valueNumber?: number | null;
    valueBool?: boolean | null;
    valueDate?: Date | string | null;
    valueJson?: unknown;
  },
): string {
  switch (type) {
    case "NUMBER":
      return answer.valueNumber?.toLocaleString("en-IN") ?? "—";
    case "CURRENCY":
      return answer.valueNumber != null
        ? `₹${answer.valueNumber.toLocaleString("en-IN")}`
        : "—";
    case "BOOLEAN":
      return answer.valueBool === null || answer.valueBool === undefined
        ? "—"
        : answer.valueBool
          ? "Yes"
          : "No";
    case "DATE":
      return answer.valueDate ? new Date(answer.valueDate).toLocaleDateString("en-IN") : "—";
    case "MULTI_SELECT":
      return Array.isArray(answer.valueJson) && answer.valueJson.length
        ? answer.valueJson.join(", ")
        : "—";
    default:
      return answer.valueText || "—";
  }
}
