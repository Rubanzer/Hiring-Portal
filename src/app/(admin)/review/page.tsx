import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { loadReviewQueue, reviewTargets } from "@/lib/review";
import { formatAnswer } from "@/lib/screening";
import { isStorageConfigured } from "@/lib/env";
import { ReviewQueue, type ReviewItem } from "@/components/review-queue";
import { Alert, Button, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Review — Hiring Portal" };

const SOURCE_LABELS: Record<string, string> = {
  AGENCY: "Agency",
  WEBSITE: "Website",
  DIRECT: "Direct",
  REFERRAL: "Referral",
};

/**
 * The triage screen: read the resume, shortlist or reject, move to the next one — without
 * opening Google Drive.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; agency?: string }>;
}) {
  await requireInternal();
  const sp = await searchParams;

  const [queue, targets, roles, agencies] = await Promise.all([
    loadReviewQueue({ jobRoleId: sp.role, agencyId: sp.agency }),
    reviewTargets(),
    prisma.jobRole.findMany({
      where: { status: { in: ["OPEN", "PAUSED"] } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.agency.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const items: ReviewItem[] = queue.map((application) => {
    const flaggedIds = Array.isArray(application.knockoutFlags)
      ? (application.knockoutFlags as string[])
      : [];

    return {
      applicationId: application.id,
      candidateName: application.candidate.fullName,
      email: application.candidate.email,
      phone: application.candidate.phoneE164,
      currentTitle: application.candidate.currentTitle,
      currentCompany: application.candidate.currentCompany,
      location: application.candidate.currentLocation,
      experienceYears: application.candidate.totalExperienceMonths
        ? `${(application.candidate.totalExperienceMonths / 12).toFixed(1)} years`
        : null,
      roleTitle: application.jobRole.title,
      sourceLabel: application.agency?.name ?? SOURCE_LABELS[application.source] ?? application.source,
      submittedAt: application.createdAt.toISOString(),
      currentCtc: application.currentCtc,
      expectedCtc: application.expectedCtc,
      noticePeriodDays: application.noticePeriodDays,
      agencyNotes: application.agencyNotes,
      // Only offer a preview once Drive has confirmed the bytes landed.
      resumeFileId: application.resumeFile?.uploadedAt ? application.resumeFile.id : null,
      resumeName: application.resumeFile?.originalName ?? null,
      flags: application.jobRole.questions
        .filter((q) => flaggedIds.includes(q.id))
        .map((q) => q.label),
      answers: application.answers.map((answer) => ({
        label: answer.question.label,
        value: formatAnswer(answer.question.type, answer),
        flagged: flaggedIds.includes(answer.questionId),
      })),
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Review"
        description={`Everyone waiting in ${targets.entry.name}, oldest first. Decide without leaving the page.`}
        action={
          <form className="flex flex-wrap gap-2">
            <Select name="role" defaultValue={sp.role ?? ""} className="h-9 w-48">
              <option value="">All roles</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </Select>
            <Select name="agency" defaultValue={sp.agency ?? ""} className="h-9 w-48">
              <option value="">All sources</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">
              Filter
            </Button>
          </form>
        }
      />

      {!isStorageConfigured() ? (
        <Alert tone="warning" title="Google Drive isn't connected yet">
          Candidate details still show here, but resumes can&apos;t be displayed until{" "}
          <code className="font-mono text-xs">GOOGLE_DRIVE_FOLDER_ID</code> and the service
          account credentials are set.
        </Alert>
      ) : null}

      {!targets.shortlist || !targets.reject ? (
        <Alert tone="warning" title="The funnel is missing a stage this screen needs">
          {!targets.shortlist
            ? "There’s no active stage after the entry stage to shortlist into. "
            : ""}
          {!targets.reject ? "There’s no stage of type Lost to reject into. " : ""}
          Add one under Settings → Funnel stages.
        </Alert>
      ) : null}

      <ReviewQueue
        items={items}
        shortlistLabel={targets.shortlist?.name ?? null}
        rejectLabel={targets.reject?.name ?? null}
      />
    </div>
  );
}
