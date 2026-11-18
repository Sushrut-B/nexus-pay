"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { MembershipView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function MembershipPage() {
  const membership = useQuery({ queryKey: ["rewards", "membership"], queryFn: () => apiFetch<MembershipView>("/api/rewards/membership") });
  const data = membership.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Loyalty</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Membership</h1>
      </div>
      {data ? (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Your tier</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="font-display text-3xl font-semibold text-navy">{data.tierName}</p>
              <p className="text-xs text-muted-foreground">Benefits: {data.benefits.join(", ") || "Standard offers"}</p>
              <p className="text-xs text-muted-foreground">Point multiplier: {(data.pointsMultiplierBps / 100).toFixed(0)}%</p>
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <p>Qualifying spend: <strong>{formatMoney(data.qualifyingSpendMinor, "INR")}</strong></p>
                <p>Qualifying transactions: <strong>{data.qualifyingTxCount}</strong></p>
                <p>Period start: {formatDateTime(data.periodStart)}</p>
                <p>Next review: {data.reviewAt ? formatDateTime(data.reviewAt) : "—"}</p>
              </div>
              {data.nextTier && data.progressBps !== null ? (
                <div>
                  <p className="text-xs text-muted-foreground">Progress to {data.nextTier}</p>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, data.progressBps / 100)}%` }} /></div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Tier history</CardTitle></CardHeader>
            <CardContent>
              {data.history.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No tier changes yet.</p> : (
                <div className="divide-y divide-border/70">
                  {data.history.map((event, index) => (
                    <div key={`${event.at}-${index}`} className="flex items-center justify-between py-2 text-xs">
                      <span>{event.direction} → {event.toTier}</span>
                      <span className="text-muted-foreground">{formatDateTime(event.at)} · {event.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
