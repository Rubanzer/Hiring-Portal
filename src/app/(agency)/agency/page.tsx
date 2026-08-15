import Link from "next/link";
import { requireAgencyUser } from "@/lib/auth";
import { agencyDashboardStats, listAgencyApplications, listAgencyRoles } from "@/lib/tenancy";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatTile,
  formatDate,
} from "@/components/ui";
import { agencyVisibleStage } from "@/lib/tenancy";

export const metadata = { title: "Dashboard — Hiring Portal" };

export default async function AgencyDashboard() {
  const user = await requireAgencyUser();

  const [roles, stats, recent] = await Promise.all([
    listAgencyRoles(user.agencyId),
    agencyDashboardStats(user.agencyId),
    listAgencyApplications(user.agencyId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description="Submit candidates for the roles assigned to your agency and follow their progress."
        action={
          roles.length > 0 ? (
            <LinkButton href="/agency/submit">Submit candidates</LinkButton>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Submitted" value={stats.total} />
        <StatTile label="In process" value={stats.inProcess} />
        <StatTile label="Accepted" value={stats.won} />
        <StatTile label="Closed" value={stats.lost} />
      </div>

      <Card>
        <CardHeader
          title="Open roles for your agency"
          description="Only roles assigned to you appear here."
        />
        {roles.length === 0 ? (
          <EmptyState
            title="No roles assigned yet"
            description="Once the hiring team assigns a role to your agency, it will show up here and you can start submitting candidates."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {roles.map(({ role, submissionLimit, submittedCount }) => {
              const full = submissionLimit !== null && submittedCount >= submissionLimit;
              return (
                <li
                  key={role.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{role.title}</p>
                    <p className="text-sm text-ink-500">
                      {[role.location, role.employmentType].filter(Boolean).join(" · ") ||
                        "No location specified"}
                      {role.questions.length > 0
                        ? ` · ${role.questions.length} qualifying question${role.questions.length === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge>
                      {submissionLimit === null
                        ? `${submittedCount} submitted`
                        : `${submittedCount} of ${submissionLimit}`}
                    </Badge>
                    {full ? (
                      <Badge color="#f59e0b">Limit reached</Badge>
                    ) : (
                      <LinkButton
                        href={`/agency/submit/${role.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Submit candidates
                      </LinkButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recent submissions"
          description="The stage shown is the candidate's current position in the hiring process."
          action={
            recent.length > 0 ? (
              <Link href="/agency/submissions" className="text-sm font-medium underline">
                View all
              </Link>
            ) : null
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing submitted yet"
            description="Your submissions and their progress will appear here."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.slice(0, 8).map((application) => {
              const shown = agencyVisibleStage(application.currentStage);
              return (
                <li key={application.id} className="px-5 py-3">
                  <Link
                    href={`/agency/submissions/${application.id}`}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {application.candidate.fullName}
                      </p>
                      <p className="text-sm text-ink-500">
                        {application.jobRole.title} · submitted{" "}
                        {formatDate(application.createdAt)}
                      </p>
                    </div>
                    <Badge color={shown.color}>{shown.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
