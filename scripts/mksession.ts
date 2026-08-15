import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

/**
 * Development helper: mints a session cookie for an existing user and prints the token.
 * Useful for smoke-testing authenticated pages with curl without driving the login form.
 * Not wired into any npm script — run it deliberately, and never against production.
 */
async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const email = process.argv[2];
  if (!email) throw new Error("Usage: tsx scripts/mksession.ts <email>");

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const token = randomBytes(32).toString("base64url");

  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  console.log(token);
  await prisma.$disconnect();
}

main();
