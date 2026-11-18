"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@nexus/ui";
import type { BorrowingOverviewView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function BorrowingPage() {
  const overview = useQuery({ queryKey: ["credit", "borrowing"], queryFn: () => apiFetch<BorrowingOverviewView>("/api/credit/borrowing") });
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Borrowing overview</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Your borrowing</h1>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>{data.notice}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Active loans" value={String(data.activeLoans)} />
            <Metric label="Outstanding principal" value={formatMoney(data.outstandingMinor, data.currency)} />
            <Metric label="Monthly commitment" value={formatMoney(data.monthlyCommitmentMinor, data.currency)} />
            <Metric label="Upcoming obligations" value={formatMoney(data.upcomingMinor, data.currency)} />
            <Metric label="Completed loans" value={String(data.completedLoans)} />
            <Metric label="Applications" value={String(data.applicationCount)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl font-semibold text-navy">{value}</p></div>;
}

