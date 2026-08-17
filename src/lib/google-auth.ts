import "server-only";
import { google } from "googleapis";
import { env, isGoogleConfigured } from "./env";

/**
 * One place that turns the service account credentials into an authenticated client.
 *
 * Only Drive uses this today, but the scopes stay a parameter: the credential handling —
 * notably the `\n` unescaping that trips everyone up when a private key is pasted into an
 * environment variable — is the part worth having in exactly one place, and a second Google
 * API would otherwise duplicate it.
 */

export class GoogleNotConfiguredError extends Error {
  constructor(what: string) {
    super(
      `${what} needs Google credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and ` +
        `GOOGLE_PRIVATE_KEY on this deployment.`,
    );
    this.name = "GoogleNotConfiguredError";
  }
}

/** Scopes used by this app. Drive needs write access to store and convert resumes. */
export const SCOPES = {
  drive: ["https://www.googleapis.com/auth/drive"],
} as const;

const cache = new Map<string, InstanceType<typeof google.auth.JWT>>();

/**
 * A JWT client for the given scopes, cached per scope set so warm invocations reuse the same
 * access token rather than re-signing on every request.
 */
export function googleJwt(scopes: readonly string[], forWhat: string) {
  if (!isGoogleConfigured()) throw new GoogleNotConfiguredError(forWhat);

  const key = scopes.join(" ");
  const existing = cache.get(key);
  if (existing) return existing;

  const client = new google.auth.JWT({
    email: env().GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Environment variables can't hold real newlines, so keys arrive with literal \n.
    key: env().GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: [...scopes],
  });

  cache.set(key, client);
  return client;
}

/** A raw OAuth access token, for the REST calls the googleapis client doesn't cover. */
export async function googleAccessToken(
  scopes: readonly string[],
  forWhat: string,
): Promise<string> {
  const { token } = await googleJwt(scopes, forWhat).getAccessToken();
  if (!token) throw new GoogleNotConfiguredError(forWhat);
  return token;
}
