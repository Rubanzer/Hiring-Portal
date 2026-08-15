/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately simple: per-instance counters, no Redis. That is the right trade for this app —
 * the limits exist to blunt credential stuffing and runaway form submission, not to enforce a
 * billing quota, and an attacker who happens to land on a different serverless instance still
 * runs into the limit on that one.
 *
 * If the app ever runs behind many instances and you want strict global limits, swap the map
 * for Upstash Redis behind this same interface — no caller changes.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bounded cleanup so a long-lived instance doesn't accumulate keys forever. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Test helper — resets all counters. */
export function resetRateLimits() {
  buckets.clear();
}
