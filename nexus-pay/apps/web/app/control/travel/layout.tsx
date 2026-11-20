"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@nexus/ui";

const TABS = [
  { href: "/control/travel", label: "Overview" },
  { href: "/control/travel/bookings", label: "Bookings" },
  { href: "/control/travel/reconciliation", label: "Reconciliation" },
];

export default function TravelControlLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <nav className="flex gap-0.5 border-b border-border/70 pb-2" aria-label="Travel operations">
        {TABS.map((tab) => {
          const active = tab.href === "/control/travel" ? pathname === tab.href : pathname.startsWith(tab.href);
          return <Link key={tab.href} href={tab.href} className={cn("rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary")}>{tab.label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
