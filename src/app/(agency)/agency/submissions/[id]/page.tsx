import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgencyUser } from "@/lib/auth";
import { agencyVisibleStage, getAgencyApplication } from "@/lib/tenancy";
import { formatAnswer } from "@/lib/screening";
import { ResumeViewer } from "@/components/resume-viewer";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/components/ui";

export default async function AgencySubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAgencyUser();

  // Scoped lookup: another agency's application id 404s rather than 403s, so the id space
  // can't be probed for which candidates exist.
  const application = await getAgencyApplication(user.agencyId, id);
  if (!application) notFound();

  const shown = agencyVisibleStage(application.currentStage);

  return (
    <div className="space-y-6">
      <PageHeader
        title={application.candidate.fullName}
        description={`Submitted for ${application.jobRole.title} on ${formatDate(application.createdAt)}`}
        action={<Badge color={shown.color}>{shown.label}</Badge>}
      />

      <Link href="/agency/submissions" className="inline-block text-sm text-ink-500 underline">
        ← All submissions
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Resume" />
            <div className="p-5 pt-4">
              <ResumeViewer
                fileId={application.resumeFile?.uploadedAt ? application.resumeFile.id : null}
                fileName={application.resumeFile?.originalName ?? null}
                height="55vh"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Candidate details" />
            <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
              <Detail label="Email" value={application.candidate.email} />
              <Detail label="Phone" value={application.candidate.phoneE164} />
              <Detail label="Current company" value={application.candidate.currentCompany} />
              <Detail label="Current title" value={application.candidate.currentTitle} />
              <Detail label="Location" value={application.candidate.currentLocation} />
              <Detail
                label="Experience"
                value={
                  application.candidate.totalExperienceMonths
                    ? `${(application.candidate.totalExperienceMonths / 12).toFixed(1)} years`
                    : null
                }
              />
              <Detail label="Current CTC" value={formatCurrency(application.currentCtc)} />
              <Detail label="Expected CTC" value={formatCurrency(application.expectedCtc)} />
              <Detail
                label="Notice period"
                value={
                  application.noticePeriodDays !== null
                    ? `${application.noticePeriodDays} days`
                    : null
                }
              />
              <Detail
                label="Resume"
                value={
                  application.resumeFile ? (
                    <a
                      href={`/api/files/${application.resumeFile.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {application.resumeFile.originalName}
                    </a>
                  ) : null
                }
              />
            </dl>
          </Card>

          {application.answers.length > 0 ? (
            <Card>
              <CardHeader title="Qualifying answers" />
              <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
                {application.answers.map((answer) => (
                  <Detail
                    key={answer.id}
                    label={answer.question.label}
                    value={formatAnswer(answer.question.type, answer)}
                  />
                ))}
              </dl>
            </Card>
          ) : null}

          {application.agencyNotes ? (
            <Card>
              <CardHeader title="Your notes" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-ink-700">
                {application.agencyNotes}
              </p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Feedback from the hiring team"
              description="Only notes the team has chosen to share appear here."
            />
            {application.notes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">No feedback shared yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {application.notes.map((note) => (
                  <li key={note.id} className="px-5 py-3">
                    <p className="whitespace-pre-wrap text-sm text-ink-700">{note.body}</p>
                    <p className="mt-1 text-xs text-ink-400">
                      {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Progress" />
            <ol className="space-y-3 px-5 py-4">
              {application.transitions
                .filter((t) => t.toStage.visibleToAgency)
                .map((transition) => {
                  const stage = agencyVisibleStage(transition.toStage);
                  return (
                    <li key={transition.id} className="flex items-start gap-3">
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <div>
                        <p className="text-sm font-medium text-ink-800">{stage.label}</p>
                        <p className="text-xs text-ink-500">
                          {formatDateTime(transition.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value || "—"}</dd>
    </div>
  );
}
