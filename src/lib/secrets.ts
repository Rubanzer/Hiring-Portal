import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for the shared secrets that guard machine-to-machine routes.
 *
 * Timing-safe rather than `===` because these are compared on every request to a public
 * endpoint: a plain string comparison returns faster the earlier it finds a mismatched byte,
 * which over enough requests leaks the secret one character at a time.
 *
 * `timingSafeEqual` throws on length mismatch, so the lengths are checked first — that does
 * leak the length of the expected secret, which is not worth defending when the secret is a
 * 32-byte random value you generated.
 */
export function verifySharedSecret(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
