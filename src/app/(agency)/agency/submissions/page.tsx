import Link from "next/link";
import { requireAgencyUser } from "@/lib/auth";
import {
  agencyVisibleStage,
  listAgencyApplications,
  listAgencyRoles,
} from "@/lib/tenancy";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  ScrollArea,
  Select,
  Button,
  formatDate,
} from "@/components/ui";

export const metadata = { title: "My submissions — Hiring Portal" };

export default async function AgencySubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; q?: string }>;
}) {
  const user = await requireAgencyUser();
  const { role, q } = await searchParams;

  const [applications, roles] = await Promise.all([
    listAgencyApplications(user.agencyId, {
      jobRoleId: role || undefined,
      search: q?.trim() || undefined,
    }),
    listAgencyRoles(user.agencyId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My submissions"
        description="Every candidate your agency has submitted, and where they've reached."
      />

      <Card>
        <CardHeader
          title="Submissions"
          description={`${applications.length} candidate${applications.length === 1 ? "" : "s"}`}
          action={
            <form className="flex flex-wrap gap-2">
              <Input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search name, email, phone"
                className="h-9 w-56"
              />
              <Select name="role" defaultValue={role ?? ""} className="h-9 w-48">
                <option value="">All roles</option>
                {roles.map(({ role: r }) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" size="sm">
                Filter
              </Button>
            </form>
          }
        />

        {applications.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description={
              q || role
                ? "No submissions match that filter."
                : "Candidates you submit will appear here with their current stage."
            }
          />
        ) : (
          <ScrollArea>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Candidate</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Stage</th>
                  <th className="px-5 py-2.5 font-medium">Submitted</th>
                  <th className="px-5 py-2.5 font-medium">Resume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {applications.map((application) => {
                  const shown = agencyVisibleStage(application.currentStage);
                  return (
                    <tr key={application.id} className="hover:bg-ink-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/agency/submissions/${application.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {application.candidate.fullName}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {application.candidate.email ??
                            application.candidate.phoneE164 ??
                            "No contact details"}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-ink-600">{application.jobRole.title}</td>
                      <td className="px-5 py-3">
                        <Badge color={shown.color}>{shown.label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-ink-500">
                        {formatDate(application.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        {application.resumeFile ? (
                          <a
                            href={`/api/files/${application.resumeFile.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ink-700 underline"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>
    </div>
  );
}
