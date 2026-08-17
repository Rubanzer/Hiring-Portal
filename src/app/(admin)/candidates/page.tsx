import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  ScrollArea,
  formatDate,
} from "@/components/ui";

export const metadata = { title: "Candidates — Hiring Portal" };

/**
 * People, not applications.
 *
 * The funnel is the per-role view; this answers "have we seen this person before?", which is
 * the question that comes up when an agency insists a candidate is new.
 */
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireInternal();
  const { q } = await searchParams;
  const search = q?.trim();

  const candidates = await prisma.candidate.findMany({
    where: search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search.toLowerCase() } },
            { phoneE164: { contains: search } },
            { currentCompany: { contains: search, mode: "insensitive" } },
          ],
        }
      : {},
    include: {
      applications: {
        include: {
          jobRole: { select: { title: true } },
          currentStage: true,
          agency: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="One record per person, across every role and every source."
      />

      <Card>
        <CardHeader
          title="All candidates"
          description={`${candidates.length} shown${candidates.length >= 300 ? " (capped at 300 — search to narrow)" : ""}`}
          action={
            <form className="flex gap-2">
              <Input
                name="q"
                defaultValue={search ?? ""}
                placeholder="Name, email, phone, company"
                className="h-9 w-64"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
        />

        {candidates.length === 0 ? (
          <EmptyState
            title={search ? "No matches" : "No candidates yet"}
            description={
              search
                ? "Nobody matches that search."
                : "Candidates arrive from agency submissions and your careers page."
            }
          />
        ) : (
          <ScrollArea>
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Contact</th>
                  <th className="px-5 py-2.5 font-medium">Currently</th>
                  <th className="px-5 py-2.5 font-medium">Applications</th>
                  <th className="px-5 py-2.5 font-medium">First seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {candidates.map((candidate) => (
                  <tr key={candidate.id} className="hover:bg-ink-50">
                    <td className="px-5 py-3 font-medium text-ink-900">
                      {candidate.fullName}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      <p>{candidate.email ?? "—"}</p>
                      <p className="text-xs text-ink-500">{candidate.phoneE164 ?? "—"}</p>
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {[candidate.currentTitle, candidate.currentCompany]
                        .filter(Boolean)
                        .join(" at ") || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {candidate.applications.map((application) => (
                          <Link
                            key={application.id}
                            href={`/candidates/${application.id}`}
                            title={`${application.jobRole.title} — ${application.currentStage.name}`}
                          >
                            <Badge color={application.currentStage.color}>
                              {application.jobRole.title}
                            </Badge>
                          </Link>
                        ))}
                        {candidate.applications.length === 0 ? (
                          <span className="text-ink-400">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {formatDate(candidate.firstSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>
    </div>
  );
}
