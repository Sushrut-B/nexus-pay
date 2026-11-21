"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Alert, AlertDescription, cn } from "@nexus/ui";

export const SUPPORT_NAV = [
  { href: "/support", label: "Support home" },
  { href: "/support/cases", label: "My cases" },
  { href: "/support/new", label: "Report an issue" },
  { href: "/support/help", label: "Help Centre" },
];

export const CONTROL_SUPPORT_NAV = [
  { href: "/control/support", label: "Inbox" },
  { href: "/control/support/escalations", label: "Escalations" },
  { href: "/control/support/analytics", label: "Analytics" },
  { href: "/control/support/articles", label: "Help articles" },
];

export function SupportHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">{title}</h1>
      {description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function SupportNav({ control = false }: { control?: boolean }) {
  const pathname = usePathname();
  const links = control ? CONTROL_SUPPORT_NAV : SUPPORT_NAV;
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Support sections">
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-full border border-border px-3 py-1.5 text-xs font-medium",
            pathname === item.href ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function SupportNotice({ children }: { children: React.ReactNode }) {
  return <Alert className="mb-5"><AlertDescription>{children}</AlertDescription></Alert>;
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p>
    </div>
  );
}

const TONES: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-800", TRIAGED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700", WAITING_FOR_USER: "bg-amber-50 text-amber-800",
  WAITING_FOR_PROVIDER: "bg-purple-50 text-purple-700", ESCALATED: "bg-red-50 text-red-700",
  RESOLUTION_PROPOSED: "bg-teal-50 text-teal-700", RESOLVED: "bg-green-50 text-green-700",
  CLOSED: "bg-slate-100 text-slate-600", REOPENED: "bg-orange-50 text-orange-700",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", TONES[status] ?? "bg-slate-100 text-slate-700")}>{status.replaceAll("_", " ")}</span>;
}
