"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

/** Nav item that highlights itself on the active route (and its sub-routes). */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // "/roles" should stay lit on "/roles/abc", but "/agency" must not light up on
  // "/agency/submissions" when that has its own nav entry — exact match wins, prefix is
  // only used for deeper paths.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
      )}
    >
      {children}
    </Link>
  );
}
