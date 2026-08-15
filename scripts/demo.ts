import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/lib/password.js";

/**
 * Demo data, so the portal can be explored without hand-entering twenty candidates.
 *
 * Creates two agencies with logins, two roles with qualifying questions, and a spread of
 * candidates across the funnel — including a deliberate cross-agency duplicate so the
 * ownership log has something in it.
 *
 * Safe to re-run: everything is keyed on stable demo emails and slugs.
 * NEVER run this against production.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPass12345";

async function main() {
  console.log("Seeding demo data…\n");

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const recruiter = await prisma.user.upsert({
    where: { email: "recruiter@example.com" },
    update: {},
    create: {
      email: "recruiter@example.com",
      name: "Anjali Verma",
      role: "RECRUITER",
      passwordHash,
    },
  });

  const agencies = await Promise.all(
    [
      { name: "Acme Talent Partners", slug: "acme-talent", window: 90 },
      { name: "Bluewave Recruiters", slug: "bluewave", window: 60 },
    ].map((a) =>
      prisma.agency.upsert({
        where: { slug: a.slug },
        update: {},
        create: {
          name: a.name,
          slug: a.slug,
          contactEmail: `contact@${a.slug}.com`,
          ownershipWindowDays: a.window,
          commissionNotes: "8.33% of annual CTC, invoiced on joining.",
        },
      }),
    ),
  );

  const agencyUsers = await Promise.all([
    prisma.user.upsert({
      where: { email: "priya@acme-talent.com" },
      update: {},
      create: {
        email: "priya@acme-talent.com",
        name: "Priya Nair",
        role: "AGENCY_OWNER",
        agencyId: agencies[0].id,
        passwordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: "sameer@bluewave.com" },
      update: {},
      create: {
        email: "sameer@bluewave.com",
        name: "Sameer Khan",
        role: "AGENCY_OWNER",
        agencyId: agencies[1].id,
        passwordHash,
      },
    }),
  ]);

  const backend = await prisma.jobRole.upsert({
    where: { id: (await findRoleId("Senior Backend Engineer")) ?? "00000000-0000-0000-0000-000000000000" },
    update: {},
    create: {
      title: "Senior Backend Engineer",
      department: "Engineering",
      location: "Bengaluru (hybrid)",
      employmentType: "Full-time",
      description:
        "Own our payments and settlement services. Strong Go or Java, comfortable with " +
        "distributed systems and on-call.",
      openings: 2,
      minExperienceMonths: 60,
      maxBudgetCtc: 4_500_000,
      status: "OPEN",
      createdByUserId: recruiter.id,
    },
  });

  const sales = await prisma.jobRole.upsert({
    where: { id: (await findRoleId("Enterprise Sales Manager")) ?? "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      title: "Enterprise Sales Manager",
      department: "Sales",
      location: "Mumbai",
      employmentType: "Full-time",
      openings: 1,
      minExperienceMonths: 48,
      maxBudgetCtc: 3_000_000,
      status: "OPEN",
      createdByUserId: recruiter.id,
    },
  });

  // Questions — only created once, so re-runs don't duplicate them.
  if ((await prisma.screeningQuestion.count({ where: { jobRoleId: backend.id } })) === 0) {
    await prisma.screeningQuestion.createMany({
      data: [
        {
          jobRoleId: backend.id,
          label: "Notice period in days",
          helpText: "How soon can they start?",
          type: "NUMBER",
          isRequired: true,
          sortOrder: 0,
          isKnockout: true,
          knockoutRule: { op: "lte", value: 45 },
        },
        {
          jobRoleId: backend.id,
          label: "Primary backend language",
          type: "SINGLE_SELECT",
          options: ["Go", "Java", "Python", "Node.js", "Other"],
          isRequired: true,
          sortOrder: 1,
          isKnockout: true,
          knockoutRule: { op: "in", value: ["Go", "Java"] },
        },
        {
          jobRoleId: backend.id,
          label: "Years of distributed-systems experience",
          type: "NUMBER",
          isRequired: true,
          sortOrder: 2,
          isKnockout: true,
          knockoutRule: { op: "gte", value: 3 },
        },
        {
          jobRoleId: backend.id,
          label: "Comfortable with a production on-call rotation?",
          type: "BOOLEAN",
          isRequired: true,
          sortOrder: 3,
          isKnockout: true,
          knockoutRule: { op: "is_true" },
        },
        {
          jobRoleId: backend.id,
          label: "Why is this candidate a fit?",
          type: "LONG_TEXT",
          isRequired: false,
          sortOrder: 4,
        },
      ],
    });
  }

  if ((await prisma.screeningQuestion.count({ where: { jobRoleId: sales.id } })) === 0) {
    await prisma.screeningQuestion.createMany({
      data: [
        {
          jobRoleId: sales.id,
          label: "Notice period in days",
          type: "NUMBER",
          isRequired: true,
          sortOrder: 0,
          isKnockout: true,
          knockoutRule: { op: "lte", value: 60 },
        },
        {
          jobRoleId: sales.id,
          label: "Largest deal closed (₹)",
          type: "CURRENCY",
          isRequired: true,
          sortOrder: 1,
          isKnockout: true,
          knockoutRule: { op: "gte", value: 5_000_000 },
        },
        {
          jobRoleId: sales.id,
          label: "Territories worked",
          type: "MULTI_SELECT",
          options: ["West", "South", "North", "East", "International"],
          isRequired: false,
          sortOrder: 2,
        },
      ],
    });
  }

  for (const agency of agencies) {
    for (const role of [backend, sales]) {
      await prisma.agencyJobAssignment.upsert({
        where: { agencyId_jobRoleId: { agencyId: agency.id, jobRoleId: role.id } },
        update: {},
        create: {
          agencyId: agency.id,
          jobRoleId: role.id,
          submissionLimit: role.id === sales.id ? 5 : null,
          assignedByUserId: recruiter.id,
        },
      });
    }
  }

  console.log(`✓ 2 agencies, 2 roles, ${agencyUsers.length} agency logins`);

  // --- Sample candidates, submitted through the real engine ---------------
  // Going through createSubmission rather than inserting rows means the demo data exercises
  // dedupe, screening and the opening stage transition exactly as a real submission would.
  const questions = await prisma.screeningQuestion.findMany({
    where: { jobRoleId: backend.id },
    orderBy: { sortOrder: "asc" },
  });
  const [notice, language, distributed, oncall, why] = questions;

  const samples = [
    {
      agency: agencies[0],
      name: "Rahul Sharma",
      email: "rahul.sharma@example.com",
      phone: "9876543210",
      current: "18 LPA",
      expected: "28 LPA",
      np: "30",
      lang: "Go",
      years: "6",
      oncall: "yes",
    },
    {
      agency: agencies[0],
      name: "Meera Iyer",
      email: "meera.iyer@example.com",
      phone: "9812345678",
      current: "22 LPA",
      expected: "32 LPA",
      np: "60", // fails the 45-day screener — arrives flagged, not rejected
      lang: "Java",
      years: "8",
      oncall: "yes",
    },
    {
      agency: agencies[0],
      name: "Karthik Reddy",
      email: "karthik.r@example.com",
      phone: "9900112233",
      current: "15 LPA",
      expected: "24 LPA",
      np: "15",
      lang: "Python", // fails the language screener
      years: "4",
      oncall: "no", // and the on-call screener
    },
    {
      agency: agencies[1],
      name: "Sneha Patil",
      email: "sneha.patil@example.com",
      phone: "9765432109",
      current: "20 LPA",
      expected: "30 LPA",
      np: "45",
      lang: "Go",
      years: "5",
      oncall: "yes",
    },
    {
      // The same human as the first entry, spelled differently, from a rival agency.
      // Should be blocked and logged against Acme's ownership.
      agency: agencies[1],
      name: "Rahul Sharma",
      email: "RAHUL.SHARMA@example.com",
      phone: "+91 98765 43210",
      current: "18 LPA",
      expected: "29 LPA",
      np: "30",
      lang: "Go",
      years: "6",
      oncall: "yes",
    },
  ];

  const { createSubmission } = await import("../src/lib/submissions.js");

  let created = 0;
  let blocked = 0;
  for (const sample of samples) {
    const result = await createSubmission({
      jobRoleId: backend.id,
      source: "AGENCY",
      agencyId: sample.agency.id,
      fullName: sample.name,
      email: sample.email,
      phone: sample.phone,
      currentCompany: "Previous Co",
      currentTitle: "Senior Engineer",
      currentLocation: "Bengaluru",
      currentCtc: sample.current,
      expectedCtc: sample.expected,
      noticePeriod: sample.np,
      agencyNotes: "Screened by us; available for a call this week.",
      answers: {
        [notice.id]: sample.np,
        [language.id]: sample.lang,
        [distributed.id]: sample.years,
        [oncall.id]: sample.oncall,
        [why.id]: "Strong payments background.",
      },
    });

    if (result.status === "created") created += 1;
    else if (result.status === "duplicate") blocked += 1;
  }

  console.log(`✓ ${created} candidates submitted, ${blocked} blocked as duplicates`);
  console.log("\nSign in with:");
  console.log(`  admin@example.com        (from db:seed)`);
  console.log(`  recruiter@example.com    ${DEMO_PASSWORD}`);
  console.log(`  priya@acme-talent.com    ${DEMO_PASSWORD}   (Acme Talent Partners)`);
  console.log(`  sameer@bluewave.com      ${DEMO_PASSWORD}   (Bluewave Recruiters)`);
  console.log("\nSubmit candidates from the agency logins to populate the funnel.\n");

  await prisma.$disconnect();
}

async function findRoleId(title: string) {
  const role = await prisma.jobRole.findFirst({ where: { title }, select: { id: true } });
  return role?.id;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
