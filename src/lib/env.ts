import { z } from "zod";

/**
 * Environment contract. Anything required for the app to boot is validated here so a
 * misconfigured deploy fails loudly at startup instead of at 2am on a resume download.
 *
 * Optional groups (storage, email, sheets) degrade gracefully: the features that need them
 * report a clear "not configured" error rather than crashing the whole app.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Resume storage (S3-compatible: Cloudflare R2, Supabase Storage, MinIO, AWS S3)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Transactional email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Hiring Portal <onboarding@resend.dev>"),

  // Google Sheets ingestion (service account with read-only scope)
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),

  // Shared secrets for machine-to-machine routes
  SHEETS_WEBHOOK_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),

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

export function isStorageConfigured() {
  const e = env();
  return Boolean(
    e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_ENDPOINT,
  );
}

export function isEmailConfigured() {
  return Boolean(env().RESEND_API_KEY);
}

export function isSheetsConfigured() {
  const e = env();
  return Boolean(e.GOOGLE_SERVICE_ACCOUNT_EMAIL && e.GOOGLE_PRIVATE_KEY);
}
