"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/tax", label: "Overview" },
  { href: "/tax/income", label: "Income" },
  { href: "/tax/compare", label: "Compare regimes" },
  { href: "/tax/capital-gains", label: "Capital gains" },
  { href: "/tax/deductions", label: "Deductions & credits" },
  { href: "/tax/documents", label: "Documents" },
  { href: "/tax/planning", label: "Planning" },
  { href: "/tax/filing", label: "Filing readiness" },
];

export function TaxNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Tax sections">
      {LINKS.map((link) => {
        const active = link.href === "/tax" ? pathname === "/tax" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
            className={cn("shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
