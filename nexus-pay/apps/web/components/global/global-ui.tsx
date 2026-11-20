"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert, AlertDescription } from "@nexus/ui";
import { cn } from "@nexus/ui";

export const GLOBAL_NAV = [
  { href: "/global-finance", label: "Overview" },
  { href: "/global-finance/accounts", label: "Currency Accounts" },
  { href: "/global-finance/converter", label: "Converter" },
  { href: "/global-finance/rates", label: "Exchange Rates" },
  { href: "/global-finance/rates/history", label: "Historical Rates" },
  { href: "/global-finance/watchlists", label: "Watchlists & Alerts" },
  { href: "/global-finance/payments", label: "International Payments" },
  { href: "/global-finance/beneficiaries", label: "Beneficiaries" },
  { href: "/global-finance/transfers", label: "Transfers" },
  { href: "/global-finance/expenses", label: "International Expenses" },
  { href: "/global-finance/travel", label: "Travel Currency" },
  { href: "/global-finance/assets", label: "Assets & Liabilities" },
  { href: "/global-finance/insights", label: "Insights" },
  { href: "/global-finance/settings", label: "Settings" },
];

export function GlobalHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">{title}</h1>
      {description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function GlobalNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Global Finance sections">
      {GLOBAL_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors",
            pathname === item.href ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function GlobalNotice({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="mb-5">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{children}</p>;
}
