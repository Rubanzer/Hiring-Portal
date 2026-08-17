// Hosting platforms inject real environment variables, so this is a no-op there. It exists so
// that a local `npm run build` behaves the same way as a deployed one instead of silently
// skipping the seed because plain node doesn't read .env.
import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Seeds the funnel stages and the first administrator as part of the build.
 *
 * Without this, a fresh deployment has correct tables and nothing in them: no stages, so no
 * board and nowhere for a submission to land; no user, so no way to sign in. Fixing that used
 * to mean cloning the repo and running `npm run db:seed` by hand, which is the one step that
 * couldn't be done from a browser.
 *
 * Safe on every deploy: stages are upserted by slug and the admin is only created when the
 * email is absent, so this is idempotent by construction rather than by a guard here.
 *
 * Runs after `prisma migrate deploy` in the build command — the tables have to exist, and that
 * step has already proven the database is reachable, which is why a failure here is treated as
 * a real fault and fails the build rather than being swallowed.
 */
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.log(
    "• No DATABASE_URL configured — skipping the seed.\n" +
      "  Set it in the project's environment variables, then redeploy.",
  );
  process.exit(0);
}

console.log("• Seeding funnel stages and the first admin…");
// `npx --no-install` rather than a bare `tsx`: npm only puts node_modules/.bin on PATH when it
// invokes the script itself, so a bare call exits 127 if this is ever run directly.
// --require-password stops a deploy creating an admin with the built-in default password.
execSync("npx --no-install tsx --conditions=react-server prisma/seed.ts --require-password", {
  stdio: "inherit",
});
