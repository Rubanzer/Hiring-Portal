import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * The Prisma client, constructed on first use rather than at import.
 *
 * Laziness is not an optimisation here, it's a build requirement. `next build` imports every
 * route module to collect page data, and nearly every route in this app reaches lib/db either
 * directly or through lib/auth. Building the client at module scope therefore demanded a
 * DATABASE_URL from the build machine — which a fresh CI runner or an unconfigured Vercel
 * project doesn't have — and failed the build before a single page rendered.
 *
 * The alternative fix, passing an empty connection string, would also stop the build failing
 * because a pg Pool doesn't connect until its first query. It was rejected: it converts a
 * precise "DATABASE_URL is required" into an opaque ECONNREFUSED at some arbitrary later
 * moment. Deferring construction keeps the useful error and simply moves it to first use.
 *
 * Prisma 7 requires an explicit driver adapter, hence PrismaPg.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Cached on globalThis in every environment: in development it stops hot reload opening a pool
 * per edit, and on serverless it lets warm invocations reuse the pool rather than build a new
 * one per request.
 */
function getClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    // Model delegates are objects whose methods are already bound to themselves; only
    // top-level functions like $transaction need rebinding off the proxy.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type { PrismaClient };
