"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/cashflow", label: "Cash flow" },
  { href: "/finance/spending", label: "Spending" },
  { href: "/finance/merchants", label: "Merchants" },
  { href: "/finance/recurring", label: "Recurring" },
  { href: "/finance/subscriptions", label: "Subscriptions" },
  { href: "/finance/goals", label: "Goals" },
  { href: "/finance/forecasts", label: "Forecasts" },
  { href: "/finance/anomalies", label: "Anomalies" },
  { href: "/finance/health", label: "Health" },
  { href: "/finance/budget-recommendations", label: "Budgets" },
  { href: "/finance/assistant", label: "Assistant" },
  { href: "/finance/reports", label: "Reports" },
  { href: "/finance/preferences", label: "Preferences" },
];

export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Finance sections">
      {LINKS.map((link) => {
        const active = link.href === "/finance" ? pathname === "/finance" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
