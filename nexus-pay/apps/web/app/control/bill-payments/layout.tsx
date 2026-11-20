"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const TABS = [
  { href: "/control/bill-payments", label: "Overview" },
  { href: "/control/bill-payments/transactions", label: "Transactions" },
  { href: "/control/bill-payments/reconciliation", label: "Reconciliation" },
];

export default function BillControlLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <nav className="flex gap-0.5 border-b border-border/70 pb-2" aria-label="Bill payment operations">
        {TABS.map((tab) => {
          const active = tab.href === "/control/bill-payments" ? pathname === tab.href : pathname.startsWith(tab.href);
          return <Link key={tab.href} href={tab.href} className={cn("rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary")}>{tab.label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
