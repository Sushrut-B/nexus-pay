"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { BillOverviewView, BillPaymentView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";

export default function BillPaymentsOverviewPage() {
  const summary = useQuery({ queryKey: ["billing", "payments"], queryFn: () => apiFetch<{ items: BillPaymentView[]; summary: BillOverviewView }>("/api/bill-payments") });
  const data = summary.data?.summary;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Bill payments</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Your bills & recharges</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "No real biller is connected. Sandbox fixtures are not real utility services. A wallet debit alone is never biller confirmation."}</AlertDescription></Alert>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Saved billers" value={String(data.savedBillers)} />
          <Metric label="Upcoming due" value={String(data.upcomingDue)} />
          <Metric label="Overdue" value={String(data.overdue)} />
          <Metric label="Monthly bill spend" value={formatMoney(data.monthlySpendMinor, data.currency)} />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Quick actions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline"><Link href="/bill-payments/marketplace">Browse billers</Link></Button>
            <Button asChild variant="outline"><Link href="/bill-payments/accounts">My billers</Link></Button>
            <Button asChild variant="outline"><Link href="/bill-payments/fetch">Fetch a bill</Link></Button>
            <Button asChild variant="outline"><Link href="/bill-payments/recharges">Recharge</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recent payments</CardTitle></CardHeader>
          <CardContent>
            {(summary.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No bill payments yet.</p> : (
              <div className="divide-y divide-border/70">
                {summary.data?.items.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs">
                    <span>{item.billerName}</span>
                    <span className="text-muted-foreground">{item.notice} · {formatMoney(item.totalMinor, "INR")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
