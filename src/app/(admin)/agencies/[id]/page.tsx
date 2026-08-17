import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DeleteUserButton, SetPasswordButton } from "@/components/user-actions";
import { deleteUserAction, setUserPasswordAction } from "../../users/actions";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ScrollArea,
  Select,
  StatTile,
  Textarea,
  formatDate,
  formatDateTime,
} from "@/components/ui";
import {
  assignRoleAction,
  createAgencyUserAction,
  revokeRoleAction,
  updateAgencyAction,
} from "../actions";

export default async function AgencyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireInternal();

  const agency = await prisma.agency.findUnique({
    where: { id },
    include: {
      users: {
        // The count feeds the delete confirmation, so it can say what survives.
        include: { _count: { select: { submittedApps: true } } },
        orderBy: { createdAt: "asc" },
      },
      jobAssignments: {
        include: { jobRole: { select: { id: true, title: true, status: true } } },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!agency) notFound();

  const [openRoles, stats, duplicates] = await Promise.all([
    prisma.jobRole.findMany({
      where: { status: "OPEN" },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.application.groupBy({
      by: ["currentStageId"],
      where: { agencyId: id },
      _count: { _all: true },
    }),
    prisma.duplicateSubmission.findMany({
      where: { attemptedByAgencyId: id },
      include: {
        candidate: { select: { fullName: true } },
        jobRole: { select: { title: true } },
        existingAgency: { select: { name: true } },
      },
      orderBy: { attemptedAt: "desc" },
      take: 20,
    }),
  ]);

  const stages = await prisma.stage.findMany({ orderBy: { sortOrder: "asc" } });
  const countByStage = new Map(stats.map((s) => [s.currentStageId, s._count._all]));
  const total = stats.reduce((sum, s) => sum + s._count._all, 0);
  const won = stages
    .filter((s) => s.kind === "WON")
    .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);
  const shortlistedStage = stages.find((s) => s.slug === "shortlisted");
  const pastShortlist = shortlistedStage
    ? stages
        .filter((s) => s.sortOrder >= shortlistedStage.sortOrder && s.kind !== "LOST")
        .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0)
    : 0;

  const assignedRoleIds = new Set(
    agency.jobAssignments.filter((a) => a.isActive).map((a) => a.jobRoleId),
  );
  const assignableRoles = openRoles.filter((r) => !assignedRoleIds.has(r.id));
  const isAdmin = viewer.role === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title={agency.name}
        description={`Portal slug: ${agency.slug} · ownership window ${agency.ownershipWindowDays} days`}
        action={
          <Badge color={agency.status === "ACTIVE" ? "#16a34a" : "#f59e0b"}>
            {agency.status === "ACTIVE" ? "Active" : "Paused"}
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Submitted" value={total} />
        <StatTile
          label="Reached shortlist"
          value={pastShortlist}
          hint={total ? `${Math.round((pastShortlist / total) * 100)}% of submissions` : undefined}
        />
        <StatTile label="Accepted" value={won} />
        <StatTile
          label="Blocked duplicates"
          value={duplicates.length}
          hint="Attempts on candidates already in the pipeline"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Roles this agency can submit to"
            description="An agency only ever sees the roles listed here."
          />
          {agency.jobAssignments.length === 0 ? (
            <EmptyState
              title="No roles assigned"
              description="Until you assign a role, this agency's submit form will be empty."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {agency.jobAssignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/roles/${assignment.jobRole.id}`}
                      className="text-sm font-medium text-ink-900 hover:underline"
                    >
                      {assignment.jobRole.title}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {assignment.isActive ? "Active" : "Revoked"} ·{" "}
                      {assignment.submissionLimit
                        ? `limit ${assignment.submissionLimit}`
                        : "no submission limit"}{" "}
                      · assigned {formatDate(assignment.assignedAt)}
                    </p>
                  </div>
                  {isAdmin && assignment.isActive ? (
                    <form action={revokeRoleAction}>
                      <input type="hidden" name="assignmentId" value={assignment.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Revoking…">
                        Revoke
                      </SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {isAdmin ? (
            <div className="border-t border-ink-200 p-5">
              {assignableRoles.length === 0 ? (
                <p className="text-sm text-ink-500">
                  Every open role is already assigned to this agency.{" "}
                  <Link href="/roles" className="underline">
                    Create another role
                  </Link>
                  .
                </p>
              ) : (
                <ActionForm action={assignRoleAction} className="space-y-3">
                  <input type="hidden" name="agencyId" value={agency.id} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <Field label="Assign a role" htmlFor="jobRoleId">
                      <Select id="jobRoleId" name="jobRoleId" required>
                        {assignableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.title}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Submission cap"
                      htmlFor="submissionLimit"
                      hint="Blank = unlimited"
                    >
                      <Input
                        id="submissionLimit"
                        name="submissionLimit"
                        type="number"
                        min={1}
                        placeholder="—"
                      />
                    </Field>
                  </div>
                  <SubmitButton size="sm" pendingLabel="Assigning…">
                    Assign role
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Logins"
            description="Each person at the agency gets their own account."
          />
          {agency.users.length === 0 ? (
            <EmptyState
              title="No logins yet"
              description="Create one below — they'll get an email to set their own password."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {agency.users.map((user) => (
                <li key={user.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">{user.name}</p>
                      <p className="truncate text-xs text-ink-500">{user.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge>
                        {user.role === "AGENCY_OWNER" ? "Owner" : "Recruiter"}
                      </Badge>
                      {!user.passwordHash ? (
                        <Badge color="#f59e0b">Invite pending</Badge>
                      ) : null}
                      {!user.isActive ? <Badge color="#dc2626">Disabled</Badge> : null}
                    </div>
                  </div>
                  {isAdmin ? (
                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      <SetPasswordButton
                        userId={user.id}
                        email={user.email}
                        action={setUserPasswordAction}
                      />
                      <DeleteUserButton
                        userId={user.id}
                        name={user.name}
                        submittedCount={user._count.submittedApps}
                        action={deleteUserAction}
                      />
                    </div>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-400">
                    {user.lastLoginAt
                      ? `Last signed in ${formatDateTime(user.lastLoginAt)}`
                      : "Never signed in"}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {isAdmin ? (
            <div className="border-t border-ink-200 p-5">
              <ActionForm action={createAgencyUserAction} className="space-y-3">
                <input type="hidden" name="agencyId" value={agency.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" htmlFor="user-name" required>
                    <Input id="user-name" name="name" required placeholder="Priya Nair" />
                  </Field>
                  <Field label="Email" htmlFor="user-email" required>
                    <Input
                      id="user-email"
                      name="email"
                      type="email"
                      required
                      placeholder="priya@acmetalent.com"
                    />
                  </Field>
                  <Field label="Phone" htmlFor="user-phone">
                    <Input id="user-phone" name="phone" placeholder="+91 98765 43210" />
                  </Field>
                  <Field label="Access level" htmlFor="user-role">
                    <Select id="user-role" name="role" defaultValue="AGENCY_RECRUITER">
                      <option value="AGENCY_RECRUITER">Recruiter — submit and track</option>
                      <option value="AGENCY_OWNER">Owner — same, plus agency contact</option>
                    </Select>
                  </Field>
                </div>
                <SubmitButton size="sm" pendingLabel="Creating…">
                  Create login and send invite
                </SubmitButton>
              </ActionForm>
            </div>
          ) : null}
        </Card>
      </div>

      {duplicates.length > 0 ? (
        <Card>
          <CardHeader
            title="Blocked duplicate submissions"
            description="Attempts to submit someone already in the pipeline. This is your evidence trail for ownership disputes."
          />
          <ScrollArea>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Candidate</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Already held by</th>
                  <th className="px-5 py-2.5 font-medium">Attempted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {duplicates.map((dup) => (
                  <tr key={dup.id}>
                    <td className="px-5 py-2.5 font-medium text-ink-800">
                      {dup.candidate.fullName}
                    </td>
                    <td className="px-5 py-2.5 text-ink-600">{dup.jobRole.title}</td>
                    <td className="px-5 py-2.5 text-ink-600">
                      {dup.existingAgency?.name ?? "Direct / website"}
                    </td>
                    <td className="px-5 py-2.5 text-ink-500">
                      {formatDateTime(dup.attemptedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader
            title="Agency settings"
            description="Pausing an agency signs its users out immediately and blocks new submissions."
          />
          <ActionForm action={updateAgencyAction} className="space-y-4 p-5">
            <input type="hidden" name="agencyId" value={agency.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agency name" htmlFor="edit-name" required>
                <Input id="edit-name" name="name" defaultValue={agency.name} required />
              </Field>
              <Field label="Status" htmlFor="edit-status">
                <Select id="edit-status" name="status" defaultValue={agency.status}>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused — no access, no submissions</option>
                </Select>
              </Field>
              <Field label="Contact email" htmlFor="edit-email">
                <Input
                  id="edit-email"
                  name="contactEmail"
                  type="email"
                  defaultValue={agency.contactEmail ?? ""}
                />
              </Field>
              <Field label="Contact phone" htmlFor="edit-phone">
                <Input
                  id="edit-phone"
                  name="contactPhone"
                  defaultValue={agency.contactPhone ?? ""}
                />
              </Field>
              <Field
                label="Ownership window (days)"
                htmlFor="edit-window"
                hint="Applies to submissions made from now on."
              >
                <Input
                  id="edit-window"
                  name="ownershipWindowDays"
                  type="number"
                  min={0}
                  max={730}
                  defaultValue={agency.ownershipWindowDays}
                />
              </Field>
            </div>
            <Field label="Commission / contract notes" htmlFor="edit-notes">
              <Textarea
                id="edit-notes"
                name="commissionNotes"
                rows={3}
                defaultValue={agency.commissionNotes ?? ""}
              />
            </Field>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Alert tone="info">Only administrators can change agency settings.</Alert>
      )}
    </div>
  );
}
