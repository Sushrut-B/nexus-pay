"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const LINKS = [
  { href: "/bill-payments", label: "Overview" },
  { href: "/bill-payments/marketplace", label: "Billers" },
  { href: "/bill-payments/accounts", label: "My billers" },
  { href: "/bill-payments/fetch", label: "Fetch a bill" },
  { href: "/bill-payments/calendar", label: "Calendar & recurring" },
  { href: "/bill-payments/recharges", label: "Recharges" },
  { href: "/bill-payments/households", label: "Households" },
  { href: "/bill-payments/history", label: "History & receipts" },
];

export function BillingNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Bill payment sections">
      {LINKS.map((link) => {
        const active = link.href === "/bill-payments" ? pathname === "/bill-payments" : pathname.startsWith(link.href);
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
