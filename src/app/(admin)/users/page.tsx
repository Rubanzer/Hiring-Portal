import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Badge,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  ScrollArea,
  Select,
  formatDateTime,
} from "@/components/ui";
import {
  createInternalUserAction,
  resendInviteAction,
  toggleUserActiveAction,
} from "./actions";

export const metadata = { title: "Users — Hiring Portal" };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  RECRUITER: "Recruiter",
  AGENCY_OWNER: "Agency owner",
  AGENCY_RECRUITER: "Agency recruiter",
};

export default async function UsersPage() {
  await requireAdmin();

  const users = await prisma.user.findMany({
    include: { agency: { select: { id: true, name: true } } },
    orderBy: [{ agencyId: "asc" }, { createdAt: "asc" }],
  });

  const internal = users.filter((u) => !u.agencyId);
  const agencyUsers = users.filter((u) => u.agencyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Everyone who can sign in. Agency logins are created from each agency's page."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <UserTable
            title="Your team"
            description="Internal users see every candidate from every source."
            users={internal}
          />
          <UserTable
            title="Agency users"
            description="Each of these sees only their own agency's submissions."
            users={agencyUsers}
          />
        </div>

        <Card className="h-fit">
          <CardHeader
            title="Add a teammate"
            description="They'll get an email to set their own password."
          />
          <ActionForm action={createInternalUserAction} className="space-y-4 p-5">
            <Field label="Name" htmlFor="name" required>
              <Input id="name" name="name" required placeholder="Anjali Verma" />
            </Field>
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="anjali@company.com"
              />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" placeholder="+91 98765 43210" />
            </Field>
            <Field
              label="Access level"
              htmlFor="role"
              hint="Recruiters can run the funnel but can't manage users, agencies or integrations."
            >
              <Select id="role" name="role" defaultValue="RECRUITER">
                <option value="RECRUITER">Recruiter</option>
                <option value="ADMIN">Admin — full access</option>
              </Select>
            </Field>
            <SubmitButton className="w-full" pendingLabel="Creating…">
              Create login and send invite
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

function UserTable({
  title,
  description,
  users,
}: {
  title: string;
  description: string;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    passwordHash: string | null;
    lastLoginAt: Date | null;
    agency: { id: string; name: string } | null;
  }>;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {users.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500">Nobody here yet.</p>
      ) : (
        <ScrollArea>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-5 py-2.5 font-medium">Access</th>
                <th className="px-5 py-2.5 font-medium">Last sign-in</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {users.map((user) => (
                <tr key={user.id} className={user.isActive ? "" : "bg-ink-50/60"}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink-900">{user.name}</p>
                    <p className="text-xs text-ink-500">{user.email}</p>
                    {user.agency ? (
                      <Link
                        href={`/agencies/${user.agency.id}`}
                        className="text-xs text-ink-500 underline"
                      >
                        {user.agency.name}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge>{ROLE_LABELS[user.role] ?? user.role}</Badge>
                      {!user.passwordHash ? (
                        <Badge color="#f59e0b">Invite pending</Badge>
                      ) : null}
                      {!user.isActive ? <Badge color="#dc2626">Disabled</Badge> : null}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-500">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <ActionForm action={resendInviteAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <SubmitButton variant="ghost" size="sm" pendingLabel="Sending…">
                          {user.passwordHash ? "Send reset" : "Resend invite"}
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm action={toggleUserActiveAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <SubmitButton
                          variant={user.isActive ? "secondary" : "primary"}
                          size="sm"
                          pendingLabel="Saving…"
                        >
                          {user.isActive ? "Disable" : "Enable"}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </Card>
  );
}
