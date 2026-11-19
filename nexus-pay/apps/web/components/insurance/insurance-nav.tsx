"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/insurance", label: "Overview" },
  { href: "/insurance/marketplace", label: "Marketplace" },
  { href: "/insurance/compare", label: "Compare" },
  { href: "/insurance/quotes", label: "Quotes" },
  { href: "/insurance/applications", label: "Applications" },
  { href: "/insurance/policies", label: "Policies" },
  { href: "/insurance/claims", label: "Claims" },
  { href: "/insurance/documents", label: "Documents" },
  { href: "/insurance/privacy", label: "Privacy" },
];

export function InsuranceNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Insurance sections">
      {LINKS.map((link) => {
        const active = link.href === "/insurance" ? pathname === "/insurance" : pathname.startsWith(link.href);
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
