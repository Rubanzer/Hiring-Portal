import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { daysInStage, listStages } from "@/lib/funnel";
import { formatAnswer, describeKnockout } from "@/lib/screening";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import {
  addNoteAction,
  assignOwnerAction,
  moveStageAction,
  recordInterviewOutcomeAction,
  scheduleInterviewAction,
} from "../../funnel/actions";

const ROUND_LABELS: Record<string, string> = {
  TELE: "Tele interview",
  R1: "Round 1",
  R2: "Round 2",
  R3: "Round 3",
};

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireInternal();

  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      candidate: {
        include: {
          applications: {
            where: { id: { not: id } },
            include: { jobRole: { select: { title: true } }, currentStage: true },
          },
        },
      },
      jobRole: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
      agency: { select: { id: true, name: true } },
      submittedBy: { select: { name: true } },
      owner: { select: { id: true, name: true } },
      currentStage: true,
      resumeFile: true,
      answers: { include: { question: true } },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      interviews: { orderBy: { scheduledAt: "desc" } },
      transitions: {
        include: {
          toStage: true,
          fromStage: true,
          changedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!application) notFound();

  const [stages, internalUsers] = await Promise.all([
    listStages(),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "RECRUITER"] }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const flaggedIds = Array.isArray(application.knockoutFlags)
    ? (application.knockoutFlags as string[])
    : [];
  const flaggedQuestions = application.jobRole.questions.filter((q) =>
    flaggedIds.includes(q.id),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={application.candidate.fullName}
        description={`${application.jobRole.title} · ${application.agency?.name ?? application.source} · submitted ${formatDate(application.createdAt)}`}
        action={
          <div className="flex items-center gap-2">
            <Badge color={application.currentStage.color}>
              {application.currentStage.name}
            </Badge>
            <span className="text-xs text-ink-500">
              {daysInStage(application.stageEnteredAt)}d in stage
            </span>
          </div>
        }
      />

      <Link href="/funnel" className="inline-block text-sm text-ink-500 underline">
        ← Back to funnel
      </Link>

      {flaggedQuestions.length > 0 ? (
        <Alert tone="warning" title="Flagged on screening questions">
          <ul className="mt-1 list-inside list-disc">
            {flaggedQuestions.map((q) => (
              <li key={q.id}>
                {q.label} — {describeKnockout(q) ?? "failed the configured rule"}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Candidate"
              action={
                application.resumeFile ? (
                  <a
                    href={`/api/files/${application.resumeFile.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium underline"
                  >
                    Open resume
                  </a>
                ) : (
                  <span className="text-sm text-ink-400">No resume</span>
                )
              }
            />
            <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
              <Detail label="Email" value={application.candidate.email} />
              <Detail label="Phone" value={application.candidate.phoneE164} />
              <Detail label="Location" value={application.candidate.currentLocation} />
              <Detail label="Current company" value={application.candidate.currentCompany} />
              <Detail label="Current title" value={application.candidate.currentTitle} />
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
                label="LinkedIn"
                value={
                  application.candidate.linkedinUrl ? (
                    <a
                      href={application.candidate.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Profile
                    </a>
                  ) : null
                }
              />
              <Detail
                label="Submitted by"
                value={application.submittedBy?.name ?? "System import"}
              />
              <Detail
                label="Agency ownership until"
                value={
                  application.ownershipExpiresAt
                    ? formatDate(application.ownershipExpiresAt)
                    : "n/a"
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
                    warn={flaggedIds.includes(answer.questionId)}
                  />
                ))}
              </dl>
            </Card>
          ) : null}

          {application.agencyNotes ? (
            <Card>
              <CardHeader
                title={`Notes from ${application.agency?.name ?? "the submitter"}`}
              />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-ink-700">
                {application.agencyNotes}
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Interviews"
              description="Scheduling an interview moves the candidate to Interview scheduled automatically."
            />

            {application.interviews.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {application.interviews.map((interview) => (
                  <li key={interview.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {ROUND_LABELS[interview.round]} ·{" "}
                          {formatDateTime(interview.scheduledAt)}
                        </p>
                        <p className="text-xs text-ink-500">
                          {interview.mode} · {interview.durationMinutes} min
                          {interview.interviewerNames.length
                            ? ` · ${interview.interviewerNames.join(", ")}`
                            : ""}
                          {interview.locationOrLink ? ` · ${interview.locationOrLink}` : ""}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Badge>{interview.status}</Badge>
                        {interview.outcome ? (
                          <Badge
                            color={
                              interview.outcome === "PASS"
                                ? "#16a34a"
                                : interview.outcome === "FAIL"
                                  ? "#dc2626"
                                  : "#f59e0b"
                            }
                          >
                            {interview.outcome}
                          </Badge>
                        ) : null}
                        {interview.rating ? <Badge>{interview.rating}/5</Badge> : null}
                      </div>
                    </div>

                    {interview.feedback ? (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
                        {interview.feedback}
                      </p>
                    ) : null}

                    <ActionForm
                      action={recordInterviewOutcomeAction}
                      className="mt-3 space-y-2"
                    >
                      <input type="hidden" name="interviewId" value={interview.id} />
                      <input type="hidden" name="applicationId" value={application.id} />
                      <div className="grid gap-2 sm:grid-cols-4">
                        <Select name="status" defaultValue={interview.status} className="h-9">
                          <option value="SCHEDULED">Scheduled</option>
                          <option value="COMPLETED">Completed</option>
                          <option value="NO_SHOW">No show</option>
                          <option value="CANCELLED">Cancelled</option>
                        </Select>
                        <Select
                          name="outcome"
                          defaultValue={interview.outcome ?? ""}
                          className="h-9"
                        >
                          <option value="">No outcome yet</option>
                          <option value="PASS">Pass</option>
                          <option value="FAIL">Fail</option>
                          <option value="HOLD">Hold</option>
                        </Select>
                        <Select
                          name="rating"
                          defaultValue={interview.rating?.toString() ?? ""}
                          className="h-9"
                        >
                          <option value="">No rating</option>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} / 5
                            </option>
                          ))}
                        </Select>
                        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                          Save outcome
                        </SubmitButton>
                      </div>
                      <Textarea
                        name="feedback"
                        rows={2}
                        defaultValue={interview.feedback ?? ""}
                        placeholder="Interviewer feedback"
                      />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="border-t border-ink-200 p-5">
              <ActionForm action={scheduleInterviewAction} className="space-y-3">
                <input type="hidden" name="applicationId" value={application.id} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Round" htmlFor="round">
                    <Select id="round" name="round" defaultValue="R1">
                      <option value="TELE">Tele interview</option>
                      <option value="R1">Round 1</option>
                      <option value="R2">Round 2</option>
                      <option value="R3">Round 3</option>
                    </Select>
                  </Field>
                  <Field label="When" htmlFor="scheduledAt" required>
                    <Input
                      id="scheduledAt"
                      name="scheduledAt"
                      type="datetime-local"
                      required
                    />
                  </Field>
                  <Field label="Duration (min)" htmlFor="durationMinutes">
                    <Input
                      id="durationMinutes"
                      name="durationMinutes"
                      type="number"
                      min={5}
                      max={480}
                      defaultValue={45}
                    />
                  </Field>
                  <Field label="Mode" htmlFor="mode">
                    <Select id="mode" name="mode" defaultValue="VIDEO">
                      <option value="VIDEO">Video</option>
                      <option value="PHONE">Phone</option>
                      <option value="ONSITE">Onsite</option>
                    </Select>
                  </Field>
                  <Field label="Link or location" htmlFor="locationOrLink">
                    <Input
                      id="locationOrLink"
                      name="locationOrLink"
                      placeholder="https://meet.google.com/…"
                    />
                  </Field>
                  <Field
                    label="Interviewers"
                    htmlFor="interviewerNames"
                    hint="Comma-separated"
                  >
                    <Input
                      id="interviewerNames"
                      name="interviewerNames"
                      placeholder="Anjali, Rahul"
                    />
                  </Field>
                </div>
                <SubmitButton size="sm" pendingLabel="Scheduling…">
                  Schedule interview
                </SubmitButton>
              </ActionForm>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              description="Internal by default. Shared notes appear in the agency's portal."
            />
            <div className="border-b border-ink-200 p-5">
              <ActionForm action={addNoteAction} className="space-y-3">
                <input type="hidden" name="applicationId" value={application.id} />
                <Textarea
                  name="body"
                  rows={3}
                  required
                  placeholder="Spoke to them — strong on the fundamentals, wants a hybrid setup."
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Select name="visibility" defaultValue="INTERNAL" className="h-9 w-64">
                    <option value="INTERNAL">Internal only</option>
                    <option value="SHARED_WITH_AGENCY">Share with the agency</option>
                  </Select>
                  <SubmitButton size="sm" pendingLabel="Saving…">
                    Add note
                  </SubmitButton>
                </div>
              </ActionForm>
            </div>

            {application.notes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">No notes yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {application.notes.map((note) => (
                  <li key={note.id} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink-800">
                        {note.author?.name ?? "System"}
                      </span>
                      {note.visibility === "SHARED_WITH_AGENCY" ? (
                        <Badge color="#0ea5e9">Shared with agency</Badge>
                      ) : null}
                      <span className="ml-auto text-xs text-ink-400">
                        {formatDateTime(note.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">
                      {note.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Move stage" />
            <ActionForm action={moveStageAction} className="space-y-3 p-5">
              <input type="hidden" name="applicationId" value={application.id} />
              <Field label="Move to" htmlFor="toStageId">
                <Select id="toStageId" name="toStageId" defaultValue="" required>
                  <option value="" disabled>
                    Pick a stage…
                  </option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Note"
                htmlFor="note"
                hint="Included in the agency email if you notify them."
              >
                <Textarea
                  id="note"
                  name="note"
                  rows={2}
                  placeholder="Strong first round — moving to round 2."
                />
              </Field>
              {application.agency ? (
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    name="notifyAgency"
                    className="size-4 rounded border-ink-300"
                  />
                  Email {application.agency.name}
                </label>
              ) : null}
              <SubmitButton className="w-full" pendingLabel="Moving…">
                Move candidate
              </SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Owner" description="Who is driving this candidate." />
            <ActionForm action={assignOwnerAction} className="space-y-3 p-5">
              <input type="hidden" name="applicationId" value={application.id} />
              <Select name="ownerUserId" defaultValue={application.owner?.id ?? ""}>
                <option value="">Unassigned</option>
                {internalUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                Save owner
              </SubmitButton>
            </ActionForm>
          </Card>

          {application.candidate.applications.length > 0 ? (
            <Card>
              <CardHeader
                title="Also applied for"
                description="The same person, tracked across every role."
              />
              <ul className="divide-y divide-ink-100">
                {application.candidate.applications.map((other) => (
                  <li key={other.id} className="flex items-center justify-between px-5 py-2.5">
                    <Link
                      href={`/candidates/${other.id}`}
                      className="text-sm text-ink-800 hover:underline"
                    >
                      {other.jobRole.title}
                    </Link>
                    <Badge color={other.currentStage.color}>{other.currentStage.name}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 px-5 py-4">
              {application.transitions.map((transition) => (
                <li key={transition.id} className="flex items-start gap-3">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: transition.toStage.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-ink-800">
                      {transition.fromStage
                        ? `${transition.fromStage.name} → ${transition.toStage.name}`
                        : `Entered ${transition.toStage.name}`}
                    </p>
                    <p className="text-xs text-ink-500">
                      {transition.changedBy?.name ?? "System"} ·{" "}
                      {formatDateTime(transition.createdAt)}
                    </p>
                    {transition.note ? (
                      <p className="mt-1 text-xs text-ink-600">{transition.note}</p>
                    ) : null}
                  </div>
                </li>
              ))}
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
  warn,
}: {
  label: string;
  value: React.ReactNode | string | null | undefined;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd
        className={
          warn ? "mt-0.5 text-sm font-medium text-amber-700" : "mt-0.5 text-sm text-ink-800"
        }
      >
        {value || "—"}
      </dd>
    </div>
  );
}
