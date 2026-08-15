import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireInternal } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ScrollArea,
  Select,
  Textarea,
} from "@/components/ui";
import { createRoleAction } from "./actions";

export const metadata = { title: "Roles — Hiring Portal" };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#64748b",
  OPEN: "#16a34a",
  PAUSED: "#f59e0b",
  CLOSED: "#dc2626",
};

export default async function RolesPage() {
  await requireInternal();

  const roles = await prisma.jobRole.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      _count: {
        select: {
          applications: true,
          questions: true,
          assignments: { where: { isActive: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="Each role carries its own qualifying questions and its own list of agencies."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="All roles" description={`${roles.length} total`} />
          {roles.length === 0 ? (
            <EmptyState
              title="No roles yet"
              description="Create a role, add its qualifying questions, then assign agencies to it."
            />
          ) : (
            <ScrollArea>
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Role</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Openings</th>
                    <th className="px-5 py-2.5 text-right font-medium">Questions</th>
                    <th className="px-5 py-2.5 text-right font-medium">Agencies</th>
                    <th className="px-5 py-2.5 text-right font-medium">Candidates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {roles.map((role) => (
                    <tr key={role.id} className="hover:bg-ink-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/roles/${role.id}`}
                          className="font-medium text-ink-900 hover:underline"
                        >
                          {role.title}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {[role.department, role.location].filter(Boolean).join(" · ") ||
                            "No department or location set"}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge color={STATUS_COLORS[role.status]}>{role.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{role.openings}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {role._count.questions}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {role._count.assignments}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {role._count.applications}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader
            title="Create a role"
            description="Only roles set to Open appear on agency submit forms."
          />
          <ActionForm action={createRoleAction} className="space-y-4 p-5">
            <Field label="Title" htmlFor="title" required>
              <Input id="title" name="title" required placeholder="Senior Backend Engineer" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" htmlFor="department">
                <Input id="department" name="department" placeholder="Engineering" />
              </Field>
              <Field label="Location" htmlFor="location">
                <Input id="location" name="location" placeholder="Bengaluru / Remote" />
              </Field>
              <Field label="Employment type" htmlFor="employmentType">
                <Input id="employmentType" name="employmentType" placeholder="Full-time" />
              </Field>
              <Field label="Openings" htmlFor="openings">
                <Input id="openings" name="openings" type="number" min={1} defaultValue={1} />
              </Field>
              <Field label="Min experience (months)" htmlFor="minExperienceMonths">
                <Input
                  id="minExperienceMonths"
                  name="minExperienceMonths"
                  type="number"
                  min={0}
                  placeholder="36"
                />
              </Field>
              <Field
                label="Budget ceiling (₹)"
                htmlFor="maxBudgetCtc"
                hint="Internal only — never shown to agencies."
              >
                <Input id="maxBudgetCtc" name="maxBudgetCtc" placeholder="2500000" />
              </Field>
            </div>
            <Field label="Description" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={4}
                placeholder="What the role involves, what a strong candidate looks like."
              />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue="DRAFT">
                <option value="DRAFT">Draft — not visible to agencies</option>
                <option value="OPEN">Open — agencies can submit</option>
                <option value="PAUSED">Paused</option>
                <option value="CLOSED">Closed</option>
              </Select>
            </Field>
            <SubmitButton className="w-full" pendingLabel="Creating…">
              Create role
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
