import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isEmailConfigured, isSheetsConfigured, isStorageConfigured } from "@/lib/env";
import { StageEditor, type EditableStage } from "@/components/stage-editor";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  ScrollArea,
  formatDateTime,
} from "@/components/ui";
import { saveStagesAction } from "./actions";

export const metadata = { title: "Settings — Hiring Portal" };

export default async function SettingsPage() {
  await requireAdmin();

  const [stages, recentActivity] = await Promise.all([
    prisma.stage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { applications: true } } },
    }),
    prisma.activityLog.findMany({
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const editable: EditableStage[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    color: s.color,
    visibleToAgency: s.visibleToAgency,
    isDefault: s.isDefault,
    applicationCount: s._count.applications,
  }));

  const integrations = [
    {
      name: "Resume storage",
      ready: isStorageConfigured(),
      hint: "S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY",
      effect: "Agencies can't attach resumes until this is set.",
    },
    {
      name: "Email",
      ready: isEmailConfigured(),
      hint: "RESEND_API_KEY",
      effect: "Invites and stage notifications are logged but not delivered.",
    },
    {
      name: "Google Sheets",
      ready: isSheetsConfigured(),
      hint: "GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY",
      effect: "Website leads won't be imported.",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="The funnel, integrations and the audit trail."
        action={
          <Link href="/settings/sheets" className="text-sm font-medium underline">
            Google Sheets sources →
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Funnel stages"
          description="Rename, reorder, recolour or add stages. Reporting keys off the stage type, not the name."
        />
        <StageEditor initialStages={editable} action={saveStagesAction} />
      </Card>

      <Card>
        <CardHeader
          title="Integrations"
          description="Set these as environment variables on the deployment."
        />
        <ul className="divide-y divide-ink-100">
          {integrations.map((integration) => (
            <li key={integration.name} className="flex items-start justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-ink-900">{integration.name}</p>
                <p className="font-mono text-xs text-ink-500">{integration.hint}</p>
                {!integration.ready ? (
                  <p className="mt-0.5 text-xs text-amber-700">{integration.effect}</p>
                ) : null}
              </div>
              <Badge color={integration.ready ? "#16a34a" : "#f59e0b"}>
                {integration.ready ? "Configured" : "Not configured"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Recent activity"
          description="Who did what. Every stage change, login and configuration edit is recorded."
        />
        <ScrollArea>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5 font-medium">Who</th>
                <th className="px-5 py-2.5 font-medium">Action</th>
                <th className="px-5 py-2.5 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {recentActivity.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-5 py-2 text-ink-500">{formatDateTime(entry.createdAt)}</td>
                  <td className="px-5 py-2 text-ink-700">{entry.actor?.name ?? "System"}</td>
                  <td className="px-5 py-2 font-mono text-xs text-ink-700">{entry.action}</td>
                  <td className="px-5 py-2 text-ink-500">{entry.entityType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </div>
  );
}
