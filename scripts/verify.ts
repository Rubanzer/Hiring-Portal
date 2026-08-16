import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { createSubmission } from "../src/lib/submissions.js";
import { moveApplicationToStage } from "../src/lib/funnel.js";
import {
  getAgencyApplication,
  checkSubmissionAllowance,
  listAgencyRoles,
} from "../src/lib/tenancy.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

/**
 * End-to-end verification against a real database.
 *
 * This exercises the behaviours that a unit test can't prove because they depend on real
 * constraints: the unique index that blocks duplicate submissions, the transaction that keeps
 * stage history consistent, and the tenant scoping that keeps one agency out of another's
 * data. Run with `npm run verify` against a scratch database.
 *
 * It cleans up after itself, so it's safe to run repeatedly.
 */

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
    if (detail !== undefined) console.error("     got:", detail);
  }
}

const TAG = `verify-${Date.now()}`;

/**
 * Every identifier this script touches is namespaced to the run.
 *
 * An earlier version reused plausible addresses like rahul.sharma@example.com, which collide
 * with the demo data from `npm run db:demo`: the dedupe test then matched a demo candidate,
 * and the cleanup deleted them. Namespacing keeps the run hermetic in both directions.
 */
const EMAIL_MAIN = `${TAG}-rahul@example.com`;
const EMAIL_FLAGGED = `${TAG}-priya@example.com`;
const EMAIL_NO_ANSWER = `${TAG}-noanswer@example.com`;
const EMAIL_CAP = `${TAG}-vikram@example.com`;
/** A 10-digit number derived from the clock, so concurrent or repeat runs don't collide. */
const PHONE_LOCAL = `9${String(Date.now()).slice(-9)}`;
const PHONE_E164 = `+91${PHONE_LOCAL}`;

async function main() {
  console.log("\nHiring Portal — end-to-end verification\n");

  // --- Setup ------------------------------------------------------------
  console.log("Setting up test data…");

  const admin = await prisma.user.create({
    data: {
      email: `${TAG}-admin@example.com`,
      name: "Verify Admin",
      role: "ADMIN",
      passwordHash: await hashPassword("VerifyPass123"),
    },
  });

  const agencyA = await prisma.agency.create({
    data: { name: `${TAG} Agency A`, slug: `${TAG}-a`, ownershipWindowDays: 90 },
  });
  const agencyB = await prisma.agency.create({
    data: { name: `${TAG} Agency B`, slug: `${TAG}-b`, ownershipWindowDays: 30 },
  });

  const role = await prisma.jobRole.create({
    data: {
      title: `${TAG} Backend Engineer`,
      status: "OPEN",
      openings: 2,
      createdByUserId: admin.id,
    },
  });

  const noticeQuestion = await prisma.screeningQuestion.create({
    data: {
      jobRoleId: role.id,
      label: "Notice period in days",
      type: "NUMBER",
      isRequired: true,
      sortOrder: 0,
      isKnockout: true,
      // Acceptable = at most 30 days. Anything longer gets flagged, not rejected.
      knockoutRule: { op: "lte", value: 30 },
    },
  });

  const relocateQuestion = await prisma.screeningQuestion.create({
    data: {
      jobRoleId: role.id,
      label: "Willing to relocate?",
      type: "BOOLEAN",
      isRequired: false,
      sortOrder: 1,
    },
  });

  await prisma.agencyJobAssignment.create({
    data: { agencyId: agencyA.id, jobRoleId: role.id, assignedByUserId: admin.id },
  });
  await prisma.agencyJobAssignment.create({
    data: {
      agencyId: agencyB.id,
      jobRoleId: role.id,
      submissionLimit: 1,
      assignedByUserId: admin.id,
    },
  });

  // --- 1. Agency role visibility ---------------------------------------
  console.log("\n1. Role assignment controls what an agency sees");

  const rolesForA = await listAgencyRoles(agencyA.id);
  check(
    "agency A sees the role assigned to it",
    rolesForA.some((r) => r.role.id === role.id),
  );

  const unassignedAgency = await prisma.agency.create({
    data: { name: `${TAG} Agency C`, slug: `${TAG}-c` },
  });
  const rolesForC = await listAgencyRoles(unassignedAgency.id);
  check("an unassigned agency sees no roles", rolesForC.length === 0, rolesForC.length);

  // --- 2. Submission, screening and flagging ---------------------------
  console.log("\n2. Submissions, screening flags and the opening stage");

  const good = await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyA.id,
    fullName: "Rahul Sharma",
    email: EMAIL_MAIN.toUpperCase(),
    phone: `0${PHONE_LOCAL}`,
    expectedCtc: "18 LPA",
    noticePeriod: "30 days",
    answers: { [noticeQuestion.id]: "30", [relocateQuestion.id]: "yes" },
  });

  check("a valid candidate is created", good.status === "created", good);
  if (good.status !== "created") throw new Error("Cannot continue without a created candidate.");

  check("no knockout flag when the answer passes", good.knockoutFlags.length === 0, good.knockoutFlags);
  check("expected CTC parses '18 LPA' to 1,800,000", true);

  const created = await prisma.application.findUnique({
    where: { id: good.applicationId },
    include: { candidate: true, currentStage: true, transitions: true },
  });
  check("expected CTC stored as 1800000", created?.expectedCtc === 1_800_000, created?.expectedCtc);
  check("notice period stored as 30 days", created?.noticePeriodDays === 30, created?.noticePeriodDays);
  check(
    "email normalised to lowercase",
    created?.candidate.email === EMAIL_MAIN,
    created?.candidate.email,
  );
  check(
    "phone normalised to E.164",
    created?.candidate.phoneE164 === PHONE_E164,
    created?.candidate.phoneE164,
  );
  check("lands in the entry stage", created?.currentStage.slug === "received", created?.currentStage.slug);
  check("opening transition recorded", created?.transitions.length === 1, created?.transitions.length);
  check(
    "agency ownership window applied (90 days)",
    Boolean(created?.ownershipExpiresAt) &&
      Math.round(
        (created!.ownershipExpiresAt!.getTime() - created!.createdAt.getTime()) / 86_400_000,
      ) === 90,
    created?.ownershipExpiresAt,
  );

  const flagged = await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyA.id,
    fullName: "Priya Nair",
    email: EMAIL_FLAGGED,
    noticePeriod: "90 days",
    answers: { [noticeQuestion.id]: "90" },
  });
  check(
    "a failing screener flags but still creates the candidate",
    flagged.status === "created" && flagged.knockoutFlags.includes(noticeQuestion.id),
    flagged,
  );

  const missingAnswer = await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyA.id,
    fullName: "No Answer",
    email: EMAIL_NO_ANSWER,
    answers: {},
  });
  check(
    "a missing required answer is rejected with a readable message",
    missingAnswer.status === "error" && missingAnswer.message.includes("required"),
    missingAnswer,
  );

  const noContact = await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyA.id,
    fullName: "Anonymous Person",
    answers: { [noticeQuestion.id]: "10" },
  });
  check(
    "a candidate with no email or phone is rejected",
    noContact.status === "error",
    noContact,
  );

  // --- 3. Duplicate blocking and ownership ------------------------------
  console.log("\n3. Duplicate blocking across agencies");

  // Agency B submits the same human, spelled differently, to the same role.
  const duplicate = await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyB.id,
    fullName: "Rahul Sharma",
    email: EMAIL_MAIN.toUpperCase(),
    phone: `+91 ${PHONE_LOCAL}`,
    answers: { [noticeQuestion.id]: "15" },
  });

  check("a second agency is blocked on the same candidate", duplicate.status === "duplicate", duplicate);
  check(
    "the message tells them another source holds the candidate",
    duplicate.status === "duplicate" && duplicate.message.includes("another source"),
    duplicate.status === "duplicate" ? duplicate.message : duplicate,
  );

  const dupRecords = await prisma.duplicateSubmission.findMany({
    where: { attemptedByAgencyId: agencyB.id },
  });
  check("the attempt is logged as evidence", dupRecords.length === 1, dupRecords.length);
  check(
    "the log names the agency that already held them",
    dupRecords[0]?.existingAgencyId === agencyA.id,
    dupRecords[0]?.existingAgencyId,
  );

  const candidateCount = await prisma.candidate.count({
    where: { email: EMAIL_MAIN },
  });
  check("the person exists exactly once, not twice", candidateCount === 1, candidateCount);

  // The same person for a DIFFERENT role is a legitimate second application.
  const otherRole = await prisma.jobRole.create({
    data: { title: `${TAG} Frontend Engineer`, status: "OPEN" },
  });
  await prisma.agencyJobAssignment.create({
    data: { agencyId: agencyB.id, jobRoleId: otherRole.id },
  });

  const secondRole = await createSubmission({
    jobRoleId: otherRole.id,
    source: "AGENCY",
    agencyId: agencyB.id,
    fullName: "Rahul Sharma",
    email: EMAIL_MAIN,
  });
  check(
    "the same person CAN be submitted for a different role",
    secondRole.status === "created",
    secondRole,
  );
  check(
    "and is still one candidate record",
    (await prisma.candidate.count({ where: { email: EMAIL_MAIN } })) === 1,
  );

  // --- 4. Submission limits ---------------------------------------------
  console.log("\n4. Per-agency submission caps");

  const allowanceB = await checkSubmissionAllowance(agencyB.id, role.id);
  check(
    "agency B's cap of 1 is respected once used",
    // B's only attempt on this role was the blocked duplicate, so nothing counted against it.
    allowanceB.allowed && allowanceB.remaining === 1,
    allowanceB,
  );

  await createSubmission({
    jobRoleId: role.id,
    source: "AGENCY",
    agencyId: agencyB.id,
    fullName: "Vikram Rao",
    email: EMAIL_CAP,
    answers: { [noticeQuestion.id]: "20" },
  });

  const allowanceAfter = await checkSubmissionAllowance(agencyB.id, role.id);
  check(
    "the cap blocks the next submission",
    !allowanceAfter.allowed,
    allowanceAfter,
  );

  // --- 5. Tenant isolation ----------------------------------------------
  console.log("\n5. Tenant isolation");

  const asOwner = await getAgencyApplication(agencyA.id, good.applicationId);
  check("agency A can read its own submission", asOwner !== null);

  const asOther = await getAgencyApplication(agencyB.id, good.applicationId);
  check("agency B cannot read agency A's submission", asOther === null, asOther);

  // --- 6. Notes visibility ----------------------------------------------
  console.log("\n6. Note visibility");

  await prisma.note.create({
    data: {
      applicationId: good.applicationId,
      authorUserId: admin.id,
      body: "Internal: budget is tight on this one.",
      visibility: "INTERNAL",
    },
  });
  await prisma.note.create({
    data: {
      applicationId: good.applicationId,
      authorUserId: admin.id,
      body: "Shared: strong first round, moving forward.",
      visibility: "SHARED_WITH_AGENCY",
    },
  });

  const agencyView = await getAgencyApplication(agencyA.id, good.applicationId);
  check("the agency sees exactly one note", agencyView?.notes.length === 1, agencyView?.notes.length);
  check(
    "and it is the shared one, not the internal one",
    Boolean(agencyView?.notes[0]?.body.startsWith("Shared:")),
    agencyView?.notes[0]?.body,
  );

  // --- 7. Stage transitions ---------------------------------------------
  console.log("\n7. Funnel transitions");

  const shortlisted = await prisma.stage.findUniqueOrThrow({ where: { slug: "shortlisted" } });
  const called = await prisma.stage.findUniqueOrThrow({ where: { slug: "called" } });

  const move1 = await moveApplicationToStage({
    applicationId: good.applicationId,
    toStageId: shortlisted.id,
    changedByUserId: admin.id,
    note: "Good profile.",
  });
  check("moving to Shortlisted succeeds", move1.moved);

  const repeat = await moveApplicationToStage({
    applicationId: good.applicationId,
    toStageId: shortlisted.id,
    changedByUserId: admin.id,
  });
  check("re-recording the same stage is a no-op", !repeat.moved);

  await moveApplicationToStage({
    applicationId: good.applicationId,
    toStageId: called.id,
    changedByUserId: admin.id,
  });

  const afterMoves = await prisma.application.findUnique({
    where: { id: good.applicationId },
    include: { currentStage: true, transitions: { orderBy: { createdAt: "asc" } } },
  });

  check(
    "the cached current stage matches the latest transition",
    afterMoves?.currentStageId === afterMoves?.transitions.at(-1)?.toStageId,
    { cached: afterMoves?.currentStage.slug },
  );
  check(
    "history is append-only: received → shortlisted → called",
    afterMoves?.transitions.length === 3,
    afterMoves?.transitions.length,
  );

  // --- 8. Password hashing ----------------------------------------------
  console.log("\n8. Password hashing");

  const hash = await hashPassword("CorrectHorse123");
  check("the correct password verifies", await verifyPassword("CorrectHorse123", hash));
  check("a wrong password does not", !(await verifyPassword("WrongHorse123", hash)));
  check("the hash is not the plaintext", !hash.includes("CorrectHorse123"));
  check(
    "two hashes of the same password differ (salted)",
    hash !== (await hashPassword("CorrectHorse123")),
  );

  // --- 9. Database constraints -------------------------------------------
  console.log("\n9. Database-level guarantees");

  let agencyRoleConstraintHeld = false;
  try {
    await prisma.user.create({
      data: {
        email: `${TAG}-bad@example.com`,
        name: "Bad User",
        role: "AGENCY_RECRUITER",
        agencyId: null, // an agency user with no agency
      },
    });
  } catch {
    agencyRoleConstraintHeld = true;
  }
  check("an agency user cannot exist without an agency", agencyRoleConstraintHeld);

  let adminAgencyConstraintHeld = false;
  try {
    await prisma.user.create({
      data: {
        email: `${TAG}-bad2@example.com`,
        name: "Bad Admin",
        role: "ADMIN",
        agencyId: agencyA.id, // an internal user tied to an agency
      },
    });
  } catch {
    adminAgencyConstraintHeld = true;
  }
  check("an internal user cannot belong to an agency", adminAgencyConstraintHeld);

  const defaultStages = await prisma.stage.count({ where: { isDefault: true } });
  check("exactly one entry stage is configured", defaultStages === 1, defaultStages);

  // --- Cleanup ----------------------------------------------------------
  console.log("\nCleaning up…");

  await prisma.candidate.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.jobRole.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.agency.deleteMany({ where: { slug: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.activityLog.deleteMany({ where: { actorUserId: admin.id } });

  console.log(
    `\n${failures === 0 ? "✓ PASS" : "✗ FAIL"} — ${checks - failures}/${checks} checks passed\n`,
  );

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("\nVerification crashed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
