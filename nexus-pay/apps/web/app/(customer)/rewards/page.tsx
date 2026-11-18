"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { RewardSummary } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function RewardsDashboardPage() {
  const summary = useQuery({ queryKey: ["rewards", "summary"], queryFn: () => apiFetch<RewardSummary>("/api/rewards/summary") });
  const data = summary.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Loyalty & rewards</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy">Your rewards</h1>
      </div>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PointsMetric label="Available points" value={data.availablePoints.toLocaleString("en-IN")} accent />
            <Metric label="Lifetime earned" value={data.lifetimeEarnedPoints.toLocaleString("en-IN")} />
            <Metric label="Redeemed" value={data.lifetimeRedeemedPoints.toLocaleString("en-IN")} />
            <Metric label="Expiring soon" value={data.expiringSoonPoints.toLocaleString("en-IN")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Cashback wallet credit</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Credited: <strong>{formatMoney(data.cashbackCreditedMinor, "INR")}</strong></p>
                <p>Pending: <strong>{formatMoney(data.cashbackPendingMinor, "INR")}</strong></p>
                <p className="text-xs text-muted-foreground">Cashback is a separate sandbox wallet credit, not points.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Membership</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Tier: <strong>{data.membership.tierName}</strong></p>
                <p>Next tier: <strong>{data.membership.nextTier ?? "Highest tier"}</strong></p>
                {data.membership.progressBps !== null ? (
                  <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, data.membership.progressBps / 100)}%` }} /></div>
                ) : null}
                <Button asChild size="sm" variant="outline"><Link href="/rewards/membership">View benefits</Link></Button>
              </CardContent>
            </Card>
          </div>
          <Alert><AlertDescription>{data.notice}</AlertDescription></Alert>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Button asChild><Link href="/rewards/offers">Explore {data.activeOffers} offers</Link></Button>
            <Button asChild variant="outline"><Link href="/rewards/catalogue">Redeem points</Link></Button>
            <Button asChild variant="outline"><Link href="/rewards/activity">View activity</Link></Button>
            <Button asChild variant="outline"><Link href="/rewards/referrals">Invite friends</Link></Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PointsMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className={`rounded-2xl border p-5 ${accent ? "border-primary/30 bg-accent" : "border-border bg-card"}`}><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
