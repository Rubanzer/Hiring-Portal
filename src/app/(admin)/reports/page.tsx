import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { daysInStage, listStages, stagnantBefore } from "@/lib/funnel";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ScrollArea,
  Select,
  Button,
  StatTile,
  cn,
} from "@/components/ui";

export const metadata = { title: "Reports — Hiring Portal" };

/** How long a candidate can sit in one active stage before it's worth flagging. */
const STALE_DAYS = 14;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  await requireInternal();
  const { role } = await searchParams;
  const roleFilter = role ? { jobRoleId: role } : {};

  // Read the clock once, before the queries, rather than inline in a filter — the render
  // path is meant to be a pure function of its inputs.
  const staleBefore = stagnantBefore(STALE_DAYS);

  const [stages, roles, agencies, grouped, sourceGroups, staleApplications] =
    await Promise.all([
      listStages(),
      prisma.jobRole.findMany({
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
      prisma.agency.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.application.groupBy({
        by: ["currentStageId"],
        where: roleFilter,
        _count: { _all: true },
      }),
      prisma.application.groupBy({
        by: ["source"],
        where: roleFilter,
        _count: { _all: true },
      }),
      prisma.application.findMany({
        where: {
          ...roleFilter,
          currentStage: { kind: "ACTIVE" },
          stageEnteredAt: { lt: staleBefore },
        },
        include: {
          candidate: { select: { fullName: true } },
          jobRole: { select: { title: true } },
          currentStage: true,
          agency: { select: { name: true } },
          owner: { select: { name: true } },
        },
        orderBy: { stageEnteredAt: "asc" },
        take: 50,
      }),
    ]);

  const countByStage = new Map(grouped.map((g) => [g.currentStageId, g._count._all]));
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);

  const activeStages = stages.filter((s) => s.kind === "ACTIVE");
  const shortlistIndex = activeStages.findIndex((s) => s.slug === "shortlisted");

  /**
   * Funnel conversion is cumulative: everyone currently in Round 2 has already passed
   * Shortlisted, so a stage's "reached" figure counts every candidate at or beyond it —
   * a snapshot of the current stage alone would understate every early stage.
   */
  const reachedAtLeast = (sortOrder: number) =>
    stages
      .filter((s) => s.sortOrder >= sortOrder && s.kind !== "LOST")
      .reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);

  // Per-agency scorecard.
  const agencyStats = await Promise.all(
    agencies.map(async (agency) => {
      const [submitted, shortlisted, accepted, duplicates] = await Promise.all([
        prisma.application.count({ where: { ...roleFilter, agencyId: agency.id } }),
        shortlistIndex >= 0
          ? prisma.application.count({
              where: {
                ...roleFilter,
                agencyId: agency.id,
                currentStage: {
                  sortOrder: { gte: activeStages[shortlistIndex].sortOrder },
                  kind: { not: "LOST" },
                },
              },
            })
          : Promise.resolve(0),
        prisma.application.count({
          where: { ...roleFilter, agencyId: agency.id, currentStage: { kind: "WON" } },
        }),
        prisma.duplicateSubmission.count({ where: { attemptedByAgencyId: agency.id } }),
      ]);

      return { agency, submitted, shortlisted, accepted, duplicates };
    }),
  );

  const ranked = agencyStats
    .filter((s) => s.submitted > 0)
    .sort((a, b) => {
      const rateA = a.submitted ? a.shortlisted / a.submitted : 0;
      const rateB = b.submitted ? b.shortlisted / b.submitted : 0;
      return rateB - rateA;
    });

  const SOURCE_LABELS: Record<string, string> = {
    AGENCY: "Agencies",
    WEBSITE: "Website",
    DIRECT: "Direct",
    REFERRAL: "Referral",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Where candidates fall out, which agencies are worth their fee, and who's gone quiet."
        action={
          <form className="flex gap-2">
            <Select name="role" defaultValue={role ?? ""} className="h-9 w-56">
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </form>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Total candidates" value={total} />
        {sourceGroups.map((group) => (
          <StatTile
            key={group.source}
            label={SOURCE_LABELS[group.source] ?? group.source}
            value={group._count._all}
            hint={total ? `${Math.round((group._count._all / total) * 100)}% of all` : undefined}
          />
        ))}
      </div>

      <Card>
        <CardHeader
          title="Funnel conversion"
          description="How many candidates have reached each stage or gone beyond it."
        />
        {total === 0 ? (
          <EmptyState title="No candidates yet" />
        ) : (
          <div className="space-y-2 p-5">
            {activeStages.map((stage) => {
              const reached = reachedAtLeast(stage.sortOrder);
              const percent = total ? (reached / total) * 100 : 0;
              return (
                <div key={stage.id} className="flex items-center gap-3">
                  <span className="w-48 shrink-0 truncate text-sm text-ink-700">
                    {stage.name}
                  </span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-ink-100">
                    <div
                      className="flex h-full items-center justify-end px-2 text-xs font-medium text-white"
                      style={{
                        width: `${Math.max(percent, 3)}%`,
                        backgroundColor: stage.color,
                      }}
                    >
                      {reached}
                    </div>
                  </div>
                  <span className="w-14 shrink-0 text-right text-sm tabular-nums text-ink-500">
                    {percent.toFixed(0)}%
                  </span>
                </div>
              );
            })}

            <div className="mt-4 flex flex-wrap gap-4 border-t border-ink-200 pt-4">
              {stages
                .filter((s) => s.kind !== "ACTIVE")
                .map((stage) => (
                  <div key={stage.id} className="flex items-center gap-2">
                    <Badge color={stage.color}>{stage.name}</Badge>
                    <span className="text-sm tabular-nums text-ink-700">
                      {countByStage.get(stage.id) ?? 0}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Agency scorecard"
          description="Ranked by shortlist rate — volume alone doesn't tell you who's sending good people."
        />
        {ranked.length === 0 ? (
          <EmptyState
            title="No agency submissions yet"
            description="Once agencies start submitting, their conversion rates appear here."
          />
        ) : (
          <ScrollArea>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Agency</th>
                  <th className="px-5 py-2.5 text-right font-medium">Submitted</th>
                  <th className="px-5 py-2.5 text-right font-medium">Shortlisted+</th>
                  <th className="px-5 py-2.5 text-right font-medium">Shortlist rate</th>
                  <th className="px-5 py-2.5 text-right font-medium">Accepted</th>
                  <th className="px-5 py-2.5 text-right font-medium">Blocked dupes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ranked.map((row) => {
                  const rate = row.submitted ? (row.shortlisted / row.submitted) * 100 : 0;
                  return (
                    <tr key={row.agency.id} className="hover:bg-ink-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/agencies/${row.agency.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {row.agency.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{row.submitted}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{row.shortlisted}</td>
                      <td
                        className={cn(
                          "px-5 py-3 text-right font-medium tabular-nums",
                          rate >= 40
                            ? "text-green-700"
                            : rate >= 20
                              ? "text-ink-700"
                              : "text-amber-700",
                        )}
                      >
                        {rate.toFixed(0)}%
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{row.accepted}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-500">
                        {row.duplicates}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Stuck for more than ${STALE_DAYS} days`}
          description="Candidates sitting in an active stage with nothing happening."
        />
        {staleApplications.length === 0 ? (
          <EmptyState
            title="Nothing is stuck"
            description={`Every active candidate has moved within the last ${STALE_DAYS} days.`}
          />
        ) : (
          <ScrollArea>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Candidate</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Stage</th>
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-5 py-2.5 font-medium">Owner</th>
                  <th className="px-5 py-2.5 text-right font-medium">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {staleApplications.map((application) => (
                  <tr key={application.id} className="hover:bg-ink-50">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/candidates/${application.id}`}
                        className="font-medium text-ink-900 hover:underline"
                      >
                        {application.candidate.fullName}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-ink-600">{application.jobRole.title}</td>
                    <td className="px-5 py-2.5">
                      <Badge color={application.currentStage.color}>
                        {application.currentStage.name}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-ink-600">
                      {application.agency?.name ?? application.source}
                    </td>
                    <td className="px-5 py-2.5 text-ink-600">
                      {application.owner?.name ?? "Unassigned"}
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums text-amber-700">
                      {daysInStage(application.stageEnteredAt)}
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
