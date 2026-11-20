"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const TABS = [
  { href: "/control/investments", label: "Overview" },
  { href: "/control/investments/jobs", label: "Sync jobs" },
  { href: "/control/investments/history", label: "History" },
];

export default function InvestmentsControlLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <nav className="flex gap-0.5 border-b border-border/70 pb-2" aria-label="Investment operations">
        {TABS.map((tab) => {
          const active = tab.href === "/control/investments" ? pathname === tab.href : pathname.startsWith(tab.href);
          return <Link key={tab.href} href={tab.href} className={cn("rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary")}>{tab.label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
