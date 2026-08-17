import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { funnelCounts } from "@/lib/funnel";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  QuestionBuilder,
  type BuilderQuestion,
  type QuestionType,
} from "@/components/question-builder";
import {
  Badge,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  StatTile,
  Textarea,
  formatCurrency,
} from "@/components/ui";
import { saveQuestionsAction, updateRoleAction } from "../actions";
import type { KnockoutOperator } from "@/lib/screening";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#64748b",
  OPEN: "#16a34a",
  PAUSED: "#f59e0b",
  CLOSED: "#dc2626",
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireInternal();

  const role = await prisma.jobRole.findUnique({
    where: { id },
    include: {
      questions: {
        orderBy: { sortOrder: "asc" },
        include: { _count: { select: { answers: true } } },
      },
      assignments: {
        where: { isActive: true },
        include: { agency: { select: { id: true, name: true, status: true } } },
      },
      _count: { select: { applications: true } },
    },
  });
  if (!role) notFound();

  const counts = await funnelCounts(role.id);
  const won = counts
    .filter((c) => c.stage.kind === "WON")
    .reduce((sum, c) => sum + c.count, 0);
  const active = counts
    .filter((c) => c.stage.kind === "ACTIVE")
    .reduce((sum, c) => sum + c.count, 0);

  const initialQuestions: BuilderQuestion[] = role.questions.map((q) => ({
    id: q.id,
    label: q.label,
    helpText: q.helpText,
    type: q.type as QuestionType,
    options: Array.isArray(q.options) ? (q.options as string[]) : null,
    isRequired: q.isRequired,
    isKnockout: q.isKnockout,
    knockoutRule: (q.knockoutRule as { op: KnockoutOperator; value?: never } | null) ?? null,
    answerCount: q._count.answers,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={role.title}
        description={
          [role.department, role.location, role.employmentType].filter(Boolean).join(" · ") ||
          undefined
        }
        action={<Badge color={STATUS_COLORS[role.status]}>{role.status}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Candidates" value={role._count.applications} />
        <StatTile label="In process" value={active} />
        <StatTile label="Accepted" value={won} hint={`${role.openings} opening(s)`} />
        <StatTile
          label="Budget ceiling"
          value={formatCurrency(role.maxBudgetCtc)}
          hint="Internal only"
        />
      </div>

      <Card>
        <CardHeader
          title="Qualifying questions"
          description="Every agency answers these for this role, which is what makes their candidates comparable."
        />
        <QuestionBuilder
          roleId={role.id}
          initialQuestions={initialQuestions}
          action={saveQuestionsAction}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Agencies working this role"
            description="Assign or revoke access from each agency's page."
          />
          {role.assignments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">
              No agencies assigned yet — this role won&apos;t appear on any agency&apos;s submit
              form.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {role.assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <Link
                    href={`/agencies/${assignment.agency.id}`}
                    className="text-sm font-medium text-ink-900 hover:underline"
                  >
                    {assignment.agency.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    {assignment.agency.status === "PAUSED" ? (
                      <Badge color="#f59e0b">Agency paused</Badge>
                    ) : null}
                    <Badge>
                      {assignment.submissionLimit
                        ? `Cap ${assignment.submissionLimit}`
                        : "No cap"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Role settings" />
          <ActionForm action={updateRoleAction} className="space-y-4 p-5">
            <input type="hidden" name="roleId" value={role.id} />
            <Field label="Title" htmlFor="edit-title" required>
              <Input id="edit-title" name="title" defaultValue={role.title} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" htmlFor="edit-department">
                <Input
                  id="edit-department"
                  name="department"
                  defaultValue={role.department ?? ""}
                />
              </Field>
              <Field label="Location" htmlFor="edit-location">
                <Input id="edit-location" name="location" defaultValue={role.location ?? ""} />
              </Field>
              <Field label="Employment type" htmlFor="edit-type">
                <Input
                  id="edit-type"
                  name="employmentType"
                  defaultValue={role.employmentType ?? ""}
                />
              </Field>
              <Field label="Openings" htmlFor="edit-openings">
                <Input
                  id="edit-openings"
                  name="openings"
                  type="number"
                  min={1}
                  defaultValue={role.openings}
                />
              </Field>
              <Field label="Min experience (months)" htmlFor="edit-exp">
                <Input
                  id="edit-exp"
                  name="minExperienceMonths"
                  type="number"
                  min={0}
                  defaultValue={role.minExperienceMonths ?? ""}
                />
              </Field>
              <Field label="Budget ceiling (₹)" htmlFor="edit-budget">
                <Input
                  id="edit-budget"
                  name="maxBudgetCtc"
                  defaultValue={role.maxBudgetCtc ?? ""}
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="edit-description">
              <Textarea
                id="edit-description"
                name="description"
                rows={4}
                defaultValue={role.description ?? ""}
              />
            </Field>
            <Field
              label="Status"
              htmlFor="edit-status"
              hint="Only Open roles appear on agency submit forms."
            >
              <Select id="edit-status" name="status" defaultValue={role.status}>
                <option value="DRAFT">Draft</option>
                <option value="OPEN">Open</option>
                <option value="PAUSED">Paused</option>
                <option value="CLOSED">Closed</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2.5 rounded-lg border border-ink-200 p-3">
              <input
                type="checkbox"
                name="restrictedToAssignedAgencies"
                defaultChecked={role.restrictedToAssignedAgencies}
                className="mt-0.5 h-4 w-4 rounded border-ink-300"
              />
              <span className="text-sm">
                <span className="font-medium text-ink-900">Restrict to specific agencies</span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  Off by default: every agency sees this role once it&apos;s Open. Turn it on for a
                  confidential search, then assign the agencies you want working it below.
                </span>
              </span>
            </label>
            <SubmitButton pendingLabel="Saving…">Save role</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
