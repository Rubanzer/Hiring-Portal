import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { daysInStage, listStages } from "@/lib/funnel";
import { FunnelBoard, type BoardColumn } from "@/components/funnel-board";
import { FunnelTable } from "@/components/funnel-table";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatTile,
  cn,
} from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Funnel — Hiring Portal" };

/** Cards loaded per column. Deep columns fall back to the table view. */
const CARDS_PER_COLUMN = 40;

const SOURCE_LABELS: Record<string, string> = {
  AGENCY: "Agency",
  WEBSITE: "Website",
  DIRECT: "Direct",
  REFERRAL: "Referral",
};

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    role?: string;
    agency?: string;
    source?: string;
    q?: string;
    flagged?: string;
    notice?: string;
  }>;
}) {
  await requireInternal();
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "board";

  const where: Prisma.ApplicationWhereInput = {
    ...(sp.role ? { jobRoleId: sp.role } : {}),
    ...(sp.agency ? { agencyId: sp.agency } : {}),
    ...(sp.source ? { source: sp.source as Prisma.EnumApplicationSourceFilter["equals"] } : {}),
    ...(sp.flagged === "1" ? { NOT: { knockoutFlags: { equals: Prisma.JsonNull } } } : {}),
    ...(sp.notice ? { noticePeriodDays: { lte: Number.parseInt(sp.notice, 10) } } : {}),
    ...(sp.q
      ? {
          candidate: {
            OR: [
              { fullName: { contains: sp.q, mode: "insensitive" } },
              { email: { contains: sp.q.toLowerCase() } },
              { phoneE164: { contains: sp.q } },
            ],
          },
        }
      : {}),
  };

  const [stages, roles, agencies, grouped, total] = await Promise.all([
    listStages(),
    prisma.jobRole.findMany({
      where: { status: { in: ["OPEN", "PAUSED"] } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.agency.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.application.groupBy({
      by: ["currentStageId"],
      where,
      _count: { _all: true },
    }),
    prisma.application.count({ where }),
  ]);

  const totalByStage = new Map(grouped.map((g) => [g.currentStageId, g._count._all]));

  // One query per column keeps each column's newest N rows, rather than taking N overall and
  // leaving late-stage columns looking empty.
  const cardsByStage = await Promise.all(
    stages.map((stage) =>
      prisma.application.findMany({
        where: { ...where, currentStageId: stage.id },
        include: {
          candidate: { select: { fullName: true } },
          jobRole: { select: { title: true } },
          agency: { select: { name: true } },
        },
        orderBy: { stageEnteredAt: "desc" },
        take: CARDS_PER_COLUMN,
      }),
    ),
  );

  const columns: BoardColumn[] = stages.map((stage, index) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    kind: stage.kind,
    total: totalByStage.get(stage.id) ?? 0,
    cards: cardsByStage[index].map((a) => ({
      id: a.id,
      candidateName: a.candidate.fullName,
      roleTitle: a.jobRole.title,
      sourceLabel: SOURCE_LABELS[a.source] ?? a.source,
      agencyName: a.agency?.name ?? null,
      expectedCtc: a.expectedCtc,
      noticePeriodDays: a.noticePeriodDays,
      daysInStage: daysInStage(a.stageEnteredAt),
      flagged: Array.isArray(a.knockoutFlags) && a.knockoutFlags.length > 0,
      stageId: a.currentStageId,
    })),
  }));

  const activeTotal = stages
    .filter((s) => s.kind === "ACTIVE")
    .reduce((sum, s) => sum + (totalByStage.get(s.id) ?? 0), 0);
  const wonTotal = stages
    .filter((s) => s.kind === "WON")
    .reduce((sum, s) => sum + (totalByStage.get(s.id) ?? 0), 0);
  const holdTotal = stages
    .filter((s) => s.kind === "HOLD")
    .reduce((sum, s) => sum + (totalByStage.get(s.id) ?? 0), 0);

  const tableRows =
    view === "table"
      ? await prisma.application.findMany({
          where,
          include: {
            candidate: true,
            jobRole: { select: { id: true, title: true } },
            agency: { select: { name: true } },
            currentStage: true,
            owner: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        })
      : [];

  const params = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => Boolean(v)) as [string, string][],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funnel"
        description="Every candidate from every source, in one pipeline."
        action={
          <div className="flex gap-1 rounded-lg border border-ink-300 bg-white p-1">
            {(["board", "table"] as const).map((mode) => {
              const next = new URLSearchParams(params);
              next.set("view", mode);
              return (
                <Link
                  key={mode}
                  href={`/funnel?${next.toString()}`}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium capitalize",
                    view === mode ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100",
                  )}
                >
                  {mode}
                </Link>
              );
            })}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Matching candidates" value={total} />
        <StatTile label="In active stages" value={activeTotal} />
        <StatTile label="Accepted" value={wonTotal} />
        <StatTile label="On hold" value={holdTotal} hint="Longer notice period" />
      </div>

      <Card>
        <CardHeader title="Filters" />
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, email, phone" />
          <Select name="role" defaultValue={sp.role ?? ""}>
            <option value="">All roles</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </Select>
          <Select name="agency" defaultValue={sp.agency ?? ""}>
            <option value="">All agencies</option>
            {agencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name}
              </option>
            ))}
          </Select>
          <Select name="source" defaultValue={sp.source ?? ""}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select name="notice" defaultValue={sp.notice ?? ""}>
            <option value="">Any notice period</option>
            <option value="0">Immediate</option>
            <option value="15">15 days or less</option>
            <option value="30">30 days or less</option>
            <option value="60">60 days or less</option>
            <option value="90">90 days or less</option>
          </Select>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="flagged"
                value="1"
                defaultChecked={sp.flagged === "1"}
                className="size-4 rounded border-ink-300"
              />
              Flagged only
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </Card>

      {total === 0 ? (
        <Card>
          <EmptyState
            title="No candidates match"
            description="Adjust the filters, or wait for agency submissions and website leads to arrive."
          />
        </Card>
      ) : view === "board" ? (
        <FunnelBoard columns={columns} />
      ) : (
        <FunnelTable
          rows={tableRows.map((a) => ({
            id: a.id,
            candidateName: a.candidate.fullName,
            email: a.candidate.email,
            phone: a.candidate.phoneE164,
            roleTitle: a.jobRole.title,
            sourceLabel: SOURCE_LABELS[a.source] ?? a.source,
            agencyName: a.agency?.name ?? null,
            stageName: a.currentStage.name,
            stageColor: a.currentStage.color,
            ownerName: a.owner?.name ?? null,
            expectedCtc: a.expectedCtc,
            noticePeriodDays: a.noticePeriodDays,
            daysInStage: daysInStage(a.stageEnteredAt),
            flagged: Array.isArray(a.knockoutFlags) && a.knockoutFlags.length > 0,
            createdAt: a.createdAt.toISOString(),
          }))}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </div>
  );
}
