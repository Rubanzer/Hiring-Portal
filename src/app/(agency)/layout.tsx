import { requireAgencyUser } from "@/lib/auth";
import { PortalShell, type NavItem } from "@/components/portal-shell";

const NAV: NavItem[] = [
  { href: "/agency", label: "Dashboard" },
  { href: "/agency/submit", label: "Submit candidates" },
  { href: "/agency/submissions", label: "My submissions" },
];

/**
 * Agency side. Internal users are redirected away by requireAgencyUser, and every page below
 * reads its data through lib/tenancy, never through Prisma directly.
 */
export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAgencyUser();

  return (
    <PortalShell
      user={user}
      nav={NAV}
      title="Hiring Portal"
      subtitle={user.agencyName}
    >
      {children}
    </PortalShell>
  );
}
