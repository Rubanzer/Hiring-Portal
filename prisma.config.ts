import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Migrations connect directly; the application connects through the pooler.
 *
 * DDL over a transaction pooler (PgBouncer, Supavisor in transaction mode) fails on advisory
 * locks and prepared statements, so `prisma migrate` needs the direct endpoint when the app is
 * using a pooled one. Falls back to DATABASE_URL when there's only one connection string.
 */
const migrationUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  /**
   * `datasource` is optional and only consulted by migrate and introspect — `prisma generate`
   * reads the schema alone. Omitting the key entirely when no URL is configured is what keeps
   * `generate`, and therefore `next build`, working on a machine with no database: a fresh CI
   * runner, or a Vercel project whose environment variables haven't been set yet.
   *
   * Prisma's own `env()` helper can't be used here — it throws the moment the variable is
   * missing, which is exactly the failure this avoids.
   */
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
