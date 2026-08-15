import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui";
import type { SessionUser } from "@/lib/auth";
import { NavLink } from "./nav-link";

export type NavItem = { href: string; label: string };

/**
 * Shared chrome for both portals. The two sides differ only in their nav items and the badge
 * under the title, which keeps the agency portal visually distinct without a second codebase.
 */
export function PortalShell({
  user,
  nav,
  title,
  subtitle,
  children,
}: {
  user: SessionUser;
  nav: NavItem[];
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href={nav[0]?.href ?? "/"} className="shrink-0">
            <span className="text-sm font-semibold tracking-tight text-ink-900">{title}</span>
            {subtitle ? (
              <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                {subtitle}
              </span>
            ) : null}
          </Link>

          <nav className="order-3 -mb-3 flex w-full gap-1 overflow-x-auto pb-1 sm:order-none sm:mb-0 sm:w-auto sm:flex-1 sm:pb-0">
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink-800">{user.name}</p>
              <p className="text-xs leading-tight text-ink-500">{user.email}</p>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
