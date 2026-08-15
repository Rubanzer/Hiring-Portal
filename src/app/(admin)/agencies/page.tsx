import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ScrollArea,
  formatDate,
} from "@/components/ui";
import { CreateAgencyForm } from "./create-agency-form";

export const metadata = { title: "Agencies — Hiring Portal" };

export default async function AgenciesPage() {
  const user = await requireInternal();

  const agencies = await prisma.agency.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          users: true,
          applications: true,
          jobAssignments: { where: { isActive: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agencies"
        description="Each agency gets its own logins and sees only the roles you assign to it."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="All agencies"
            description={`${agencies.length} ${agencies.length === 1 ? "agency" : "agencies"}`}
          />
          {agencies.length === 0 ? (
            <EmptyState
              title="No agencies yet"
              description="Create one to generate their portal and invite their recruiters."
            />
          ) : (
            <ScrollArea>
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Agency</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Roles</th>
                    <th className="px-5 py-2.5 text-right font-medium">Logins</th>
                    <th className="px-5 py-2.5 text-right font-medium">Submitted</th>
                    <th className="px-5 py-2.5 text-right font-medium">Ownership</th>
                    <th className="px-5 py-2.5 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {agencies.map((agency) => (
                    <tr key={agency.id} className="hover:bg-ink-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/agencies/${agency.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {agency.name}
                        </Link>
                        {agency.contactEmail ? (
                          <p className="text-xs text-ink-500">{agency.contactEmail}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        <Badge color={agency.status === "ACTIVE" ? "#16a34a" : "#f59e0b"}>
                          {agency.status === "ACTIVE" ? "Active" : "Paused"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {agency._count.jobAssignments}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {agency._count.users}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {agency._count.applications}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-600">
                        {agency.ownershipWindowDays}d
                      </td>
                      <td className="px-5 py-3 text-ink-500">{formatDate(agency.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </Card>

        {user.role === "ADMIN" ? (
          <CreateAgencyForm />
        ) : (
          <Card className="p-5">
            <p className="text-sm text-ink-500">
              Only administrators can add agencies or issue logins.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
