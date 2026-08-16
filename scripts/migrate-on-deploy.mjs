// Hosting platforms inject real environment variables, so this is a no-op there. It exists so
// that a local `npm run build` behaves the same way as a deployed one instead of silently
// skipping the migration because plain node doesn't read .env.
import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Applies pending migrations as part of the build, but only when a database is configured.
 *
 * Running `prisma migrate deploy` unconditionally would fail every build made before the
 * project has a database — which is the wrong way round: you need a deployed app in order to
 * attach a database to it. Skipping cleanly means the first deploy goes green, you add the
 * connection string, and the next deploy migrates.
 *
 * prisma.config.ts prefers DIRECT_DATABASE_URL for exactly this command, because DDL over a
 * transaction pooler fails on advisory locks. The same precedence is mirrored here so the
 * skip decision matches what the migration would actually connect to.
 */
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.log(
    "• No DATABASE_URL configured — skipping `prisma migrate deploy`.\n" +
      "  Set it in the project's environment variables, then redeploy to apply migrations.",
  );
  process.exit(0);
}

console.log("• Applying database migrations…");
// `npx --no-install` rather than a bare `prisma`: npm only puts node_modules/.bin on PATH when
// it invokes the script itself, so a bare call exits 127 if this is ever run directly. The
// --no-install flag keeps it offline and fails loudly if the CLI genuinely isn't installed.
execSync("npx --no-install prisma migrate deploy", { stdio: "inherit" });
