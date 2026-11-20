"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/investments", label: "Overview" },
  { href: "/investments/portfolio", label: "Portfolio" },
  { href: "/investments/connections", label: "Connections" },
  { href: "/investments/explore", label: "Explore" },
  { href: "/investments/watchlist", label: "Watchlist" },
  { href: "/investments/sips", label: "SIPs" },
  { href: "/investments/wealth", label: "Wealth" },
  { href: "/investments/goals", label: "Goals" },
  { href: "/investments/documents", label: "Documents" },
];

export function InvestmentsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Investment sections">
      {LINKS.map((link) => {
        const active = link.href === "/investments" ? pathname === "/investments" : pathname.startsWith(link.href);
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
