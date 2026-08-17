import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardPublicRequest } from "@/lib/public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The open roles and their questions, so your careers page can build its own form.
 *
 * This is what makes the portal the single place roles are managed: open a role in the portal,
 * add questions to it, and the careers site picks both up on its next request without anyone
 * touching the careers code.
 *
 * Two things are deliberately withheld. `isKnockout` and `knockoutRule` never leave the portal
 * — an applicant who can see which answers are screened, and the thresholds, can tune their
 * answers to pass. The portal already keeps that from agencies; a public endpoint is a worse
 * place to leak it. `maxBudgetCtc` is withheld for the same reason it's withheld from agencies:
 * it's your ceiling, not a number to negotiate against.
 */
export async function GET(request: Request) {
  const guard = guardPublicRequest(request, {
    name: "public-roles",
    max: 600,
    windowMs: 60 * 60_000,
  });
  if (!guard.ok) return guard.response;

  const roles = await prisma.jobRole.findMany({
    // OPEN only. A PAUSED role is one you've stopped taking applications for, and a DRAFT is
    // one you haven't finished writing — neither should appear on a public careers page.
    where: { status: "OPEN" },
    orderBy: [{ title: "asc" }],
    select: {
      id: true,
      title: true,
      department: true,
      location: true,
      employmentType: true,
      description: true,
      openings: true,
      minExperienceMonths: true,
      questions: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          label: true,
          helpText: true,
          type: true,
          options: true,
          isRequired: true,
        },
      },
    },
  });

  return NextResponse.json(
    {
      roles: roles.map((role) => ({
        ...role,
        questions: role.questions.map((question) => ({
          ...question,
          // Stored as JSON; always hand the caller an array so it can map over it directly.
          options: Array.isArray(question.options) ? question.options : [],
        })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
