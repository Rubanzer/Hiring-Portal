import { requireInternal } from "@/lib/auth";
import { PortalShell, type NavItem } from "@/components/portal-shell";

const BASE_NAV: NavItem[] = [
  { href: "/review", label: "Review" },
  { href: "/funnel", label: "Funnel" },
  { href: "/candidates", label: "Candidates" },
  { href: "/roles", label: "Roles" },
  { href: "/agencies", label: "Agencies" },
  { href: "/reports", label: "Reports" },
];

const ADMIN_ONLY_NAV: NavItem[] = [
  { href: "/users", label: "Users" },
  { href: "/settings", label: "Settings" },
];

/** Internal side. Agency users hitting these routes are redirected by requireInternal. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireInternal();
  const nav = user.role === "ADMIN" ? [...BASE_NAV, ...ADMIN_ONLY_NAV] : BASE_NAV;

  return (
    <PortalShell user={user} nav={nav} title="Hiring Portal">
      {children}
    </PortalShell>
  );
}
