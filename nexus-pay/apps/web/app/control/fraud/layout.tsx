"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const TABS = [
  { href: "/control/fraud", label: "Overview" },
  { href: "/control/fraud/events", label: "Security events" },
  { href: "/control/fraud/alerts", label: "Alerts" },
  { href: "/control/fraud/cases", label: "Investigations" },
  { href: "/control/fraud/rules", label: "Rules" },
  { href: "/control/fraud/risk-policies", label: "Policies" },
  { href: "/control/fraud/models", label: "Models" },
  { href: "/control/fraud/audit", label: "Audit" },
];

export default function FraudControlLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <nav className="flex gap-0.5 overflow-x-auto border-b border-border/70 pb-2" aria-label="Fraud intelligence sections">
        {TABS.map((tab) => {
          const active = tab.href === "/control/fraud" ? pathname === "/control/fraud" : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}
              className={cn("shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
