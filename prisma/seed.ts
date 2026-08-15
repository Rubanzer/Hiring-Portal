import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

/**
 * Seeds the funnel and the first administrator.
 *
 * Safe to re-run: stages are upserted by slug and the admin is only created if absent, so
 * this can be part of a deploy without wiping anything.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * The funnel as specified, in order. `kind` is what the application logic branches on:
 * ACTIVE stages become board columns, WON/LOST close an application out, HOLD parks it
 * somewhere it stays findable.
 */
const STAGES = [
  { slug: "received", name: "Received", kind: "ACTIVE", color: "#64748b", isDefault: true },
  { slug: "shortlisted", name: "Shortlisted", kind: "ACTIVE", color: "#0ea5e9" },
  { slug: "called", name: "Called", kind: "ACTIVE", color: "#6366f1" },
  { slug: "tele-interview", name: "Tele interview", kind: "ACTIVE", color: "#8b5cf6" },
  { slug: "interview-scheduled", name: "Interview scheduled", kind: "ACTIVE", color: "#a855f7" },
  { slug: "interviewed-r1", name: "Interviewed — Round 1", kind: "ACTIVE", color: "#d946ef" },
  { slug: "interviewed-r2", name: "Interviewed — Round 2", kind: "ACTIVE", color: "#ec4899" },
  { slug: "interviewed-r3", name: "Interviewed — Round 3", kind: "ACTIVE", color: "#f43f5e" },
  { slug: "accepted", name: "Accepted", kind: "WON", color: "#16a34a" },
  { slug: "rejected-by-candidate", name: "Rejected by candidate", kind: "LOST", color: "#dc2626" },
  {
    // Not a rejection: the candidate is good but can't start soon enough. Parked, revivable,
    // and excluded from active-pipeline counts.
    slug: "longer-notice-period",
    name: "Longer notice period",
    kind: "HOLD",
    color: "#f59e0b",
  },
  {
    // Your own rejection, distinct from the candidate walking away. Flagged in the plan as an
    // addition — shortlisting implies rejecting, and the two outcomes report very differently.
    slug: "not-selected",
    name: "Not selected",
    kind: "LOST",
    color: "#991b1b",
    visibleToAgency: true,
  },
] as const;

async function seedStages() {
  for (const [index, stage] of STAGES.entries()) {
    await prisma.stage.upsert({
      where: { slug: stage.slug },
      update: {
        name: stage.name,
        sortOrder: index,
        kind: stage.kind,
        color: stage.color,
      },
      create: {
        slug: stage.slug,
        name: stage.name,
        sortOrder: index,
        kind: stage.kind,
        color: stage.color,
        isDefault: "isDefault" in stage ? stage.isDefault : false,
        visibleToAgency: true,
      },
    });
  }
  console.log(`✓ ${STAGES.length} funnel stages`);
}

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe12345";
  const name = process.env.SEED_ADMIN_NAME ?? "Portal Admin";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• admin ${email} already exists, left untouched`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      passwordHash: await hashPassword(password),
    },
  });

  console.log(`✓ admin created: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`  password: ${password}  ← change this immediately`);
  }
}

async function main() {
  await seedStages();
  await seedAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
