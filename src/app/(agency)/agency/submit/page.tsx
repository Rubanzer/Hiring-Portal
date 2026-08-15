import { requireAgencyUser } from "@/lib/auth";
import { listAgencyRoles } from "@/lib/tenancy";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
} from "@/components/ui";

export const metadata = { title: "Submit candidates — Hiring Portal" };

/** Role picker. The submit form itself lives one level down, at /agency/submit/[roleId]. */
export default async function SubmitPickRolePage() {
  const user = await requireAgencyUser();
  const roles = await listAgencyRoles(user.agencyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit candidates"
        description="Pick the role you're submitting for. Each role has its own qualifying questions."
      />

      <Card>
        <CardHeader title="Roles open to your agency" />
        {roles.length === 0 ? (
          <EmptyState
            title="No roles assigned"
            description="The hiring team hasn't assigned any open roles to your agency yet."
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
                      {[role.department, role.location].filter(Boolean).join(" · ") ||
                        "No location specified"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {submissionLimit !== null ? (
                      <Badge color={full ? "#f59e0b" : undefined}>
                        {submittedCount} of {submissionLimit}
                      </Badge>
                    ) : null}
                    <LinkButton
                      href={`/agency/submit/${role.id}`}
                      variant={full ? "secondary" : "primary"}
                      size="sm"
                    >
                      {full ? "Limit reached" : "Open form"}
                    </LinkButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
