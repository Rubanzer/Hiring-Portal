import { z } from "zod";

/**
 * Environment contract. Anything required for the app to boot is validated here so a
 * misconfigured deploy fails loudly at startup instead of at 2am on a resume download.
 *
 * Optional groups (storage, email, the careers API) degrade gracefully: the features that need
 * them report a clear "not configured" error rather than crashing the whole app.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Transactional email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Hiring Portal <onboarding@resend.dev>"),

  // Google service account — signs the requests that store and read resumes in Drive.
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),

  /// Folder inside a Shared Drive where resumes are written. A Shared Drive specifically:
  /// a service account has no storage quota of its own, so writing into someone's My Drive
  /// fails with 403 storageQuotaExceeded.
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),

  /// Shared secret your careers site sends as X-API-Key when it posts an application.
  /// Without it every /api/public route refuses, so the endpoints are closed by default
  /// rather than open until someone remembers to protect them.
  CAREERS_API_KEY: z.string().optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: z.infer<typeof schema> | null = null;

export function env() {
  cached ??= load();
  return cached;
}

/** Service account credentials are present — the prerequisite for Drive. */
export function isGoogleConfigured() {
  const e = env();
  return Boolean(e.GOOGLE_SERVICE_ACCOUNT_EMAIL && e.GOOGLE_PRIVATE_KEY);
}

/** Resume storage needs the credentials plus somewhere to put the files. */
export function isStorageConfigured() {
  return isGoogleConfigured() && Boolean(env().GOOGLE_DRIVE_FOLDER_ID);
}

export function isEmailConfigured() {
  return Boolean(env().RESEND_API_KEY);
}

/** The careers site can post applications only once a key exists to authenticate it. */
export function isCareersApiConfigured() {
  return Boolean(env().CAREERS_API_KEY);
}
