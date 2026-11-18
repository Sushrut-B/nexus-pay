"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@nexus/ui";
import {
  Activity, AlertTriangle, BellRing, BrainCircuit, ChevronRight, CreditCard, FileClock, Gauge, GitBranch,
  Landmark, LockKeyhole, Repeat, Search, Shield, SlidersHorizontal, Store, Terminal, Users, Zap,
} from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api/client";

interface Session { email: string; username: string; role: string }

const NAV = [
  { href: "/control", label: "Overview", icon: Gauge },
  { href: "/control/cluster", label: "Cluster", icon: GitBranch },
  { href: "/control/nodes", label: "Nodes", icon: Activity },
  { href: "/control/leader-elections", label: "Leader Elections", icon: Zap },
  { href: "/control/chaos", label: "Chaos Engineering", icon: AlertTriangle },
  { href: "/control/payments", label: "Payments", icon: Search },
  { href: "/control/reconciliation", label: "Reconciliation", icon: Shield },
  { href: "/control/metrics", label: "Metrics", icon: SlidersHorizontal },
  { href: "/control/alerts", label: "Alerts", icon: BellRing },
  { href: "/control/audit", label: "Audit Logs", icon: FileClock },
  { href: "/control/diagnostics", label: "Diagnostics", icon: Terminal },
  { href: "/control/merchants", label: "Merchants", icon: Store },
  { href: "/control/merchant-refunds", label: "Merchant Refunds", icon: Shield },
  { href: "/control/subscriptions", label: "Subscriptions", icon: Repeat },
  { href: "/control/billing", label: "Billing Operations", icon: CreditCard },
  { href: "/control/rewards", label: "Rewards", icon: Repeat },
  { href: "/control/finance", label: "Financial Intelligence", icon: BrainCircuit },
  { href: "/control/accounts", label: "External Accounts", icon: Landmark },
  { href: "/control/credit", label: "Credit Operations", icon: CreditCard },
  { href: "/control/admin", label: "Administration", icon: Users, adminOnly: true },
];

export function ControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isLogin = pathname === "/control/login";
  const [signingOut, setSigningOut] = useState(false);

  const session = useQuery({
    queryKey: ["control", "session"],
    queryFn: () => apiFetch<Session>("/api/control/session"),
    retry: false,
    enabled: !isLogin,
  });

  useEffect(() => {
    if (isLogin) return;
    if (session.error instanceof ApiClientError && session.error.status === 401) {
      router.replace(`/control/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLogin, session.error, router, pathname]);

  const logout = useMutation({
    mutationFn: () =>
      apiFetch("/api/control/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["control"] });
      router.replace("/control/login");
    },
  });

  if (isLogin) return <>{children}</>;

  const role = session.data?.role ?? "VIEWER";

  return (
    <div className="min-h-screen bg-[#f5f5f4] text-[#1c1917]">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-[#0f172a] text-slate-200 lg:flex">
          <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">N</span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">NEXUS CONTROL</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Operations plane</p>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {NAV.filter((item) => !item.adminOnly || role === "SUPER_ADMIN").map((item) => {
              const active = item.href === "/control" ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                    active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                  {active ? <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-500" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-slate-800 p-4">
            <p className="truncate text-xs font-medium text-slate-200">{session.data?.email ?? "Loading…"}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{role.replace("_", " ")}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start text-slate-400 hover:text-white"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                logout.mutate();
              }}
            >
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="font-medium text-slate-900">Nexus Control</span>
              <span className="text-slate-300">/</span>
              <span>{NAV.find((item) => (item.href === "/control" ? pathname === item.href : pathname.startsWith(item.href)))?.label ?? "Operations"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />live
              </span>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white">
                {role.replace("_", " ")}
              </span>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
