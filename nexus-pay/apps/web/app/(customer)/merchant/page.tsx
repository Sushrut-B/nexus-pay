"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import type { MerchantView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

interface Dashboard {
  merchant: { id: string; displayName: string; handle: string; status: string; logoUrl: string | null; brandColor: string | null };
  totalVolumeMinor: number;
  successfulPayments: number;
  pendingPayments: number;
  failedPayments: number;
  refundCount: number;
  orders: number;
  customers: number;
  recentPayments: Array<{ id: string; paymentRef: string; amountMinor: number; currency: string; status: string; source: string; createdAt: string }>;
}

export default function MerchantDashboardPage() {
  const merchant = useQuery({
    queryKey: ["merchant", "me"],
    queryFn: () => apiFetch<MerchantView>("/api/merchants"),
    retry: false,
  });
  const dashboard = useQuery({
    queryKey: ["merchant", "dashboard"],
    queryFn: () => apiFetch<Dashboard>("/api/merchant/analytics/overview"),
    enabled: merchant.data?.status === "ACTIVE",
  });

  if (!merchant.data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Business dashboard</h1>
        <Card><CardContent className="py-12 text-center">
          <p className="text-sm font-medium">No merchant account yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a sandbox business account to accept payments.</p>
          <Button asChild className="mt-4"><Link href="/merchant/onboarding">Start accepting payments</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Pay for Business</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">{merchant.data.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">@{merchant.data.handle} · status {merchant.data.status.replaceAll("_", " ")}</p>
        </div>
        {merchant.data.status !== "ACTIVE" ? (
          <Button asChild variant="outline"><Link href="/merchant/onboarding">Continue onboarding</Link></Button>
        ) : null}
      </div>

      {merchant.data.status !== "ACTIVE" ? (
        <Alert><AlertDescription>Your sandbox account is not active. Payment acceptance is disabled until approval.</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total volume" value={formatMoney(dashboard.data?.totalVolumeMinor ?? 0, "INR")} />
        <Metric label="Successful payments" value={String(dashboard.data?.successfulPayments ?? 0)} />
        <Metric label="Orders" value={String(dashboard.data?.orders ?? 0)} />
        <Metric label="Customers" value={String(dashboard.data?.customers ?? 0)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle className="text-base">Quick actions</CardTitle><CardDescription>Everything you need to get paid.</CardDescription></div>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild><Link href="/merchant/payment-links">Create payment link</Link></Button>
            <Button asChild variant="outline"><Link href="/merchant/qr">Show merchant QR</Link></Button>
            <Button asChild variant="outline"><Link href="/merchant/orders">Create order</Link></Button>
            <Button asChild variant="outline"><Link href="/merchant/analytics">View analytics</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recent payments</CardTitle><CardDescription>Only verified settlements appear here.</CardDescription></CardHeader>
          <CardContent>
            {(dashboard.data?.recentPayments ?? []).length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No payments yet.</p>
            ) : (
              <div className="divide-y divide-border/70">
                {dashboard.data?.recentPayments.map((payment) => (
                  <Link key={payment.id} href={`/transactions/${encodeURIComponent(payment.paymentRef)}`} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="truncate font-mono text-xs">{payment.paymentRef}</span>
                    <span className="font-semibold">{formatMoney(payment.amountMinor, payment.currency)}</span>
                  </Link>
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
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p>
    </div>
  );
}


