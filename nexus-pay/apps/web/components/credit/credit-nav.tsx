"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/credit", label: "Marketplace" },
  { href: "/credit/compare", label: "Compare" },
  { href: "/credit/eligibility", label: "Eligibility" },
  { href: "/credit/applications", label: "Applications" },
  { href: "/credit/loans", label: "My loans" },
  { href: "/credit/borrowing", label: "Borrowing overview" },
  { href: "/credit/affordability", label: "Affordability" },
];

export function CreditNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Credit sections">
      {LINKS.map((link) => {
        const active = link.href === "/credit" ? pathname === "/credit" : pathname.startsWith(link.href);
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
