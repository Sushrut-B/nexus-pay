"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SubscriptionView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function MySubscriptionsPage() {
  const subscriptions = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => apiFetch<{ items: SubscriptionView[] }>("/api/subscriptions"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your recurring payments</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">My subscriptions</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Subscriptions</CardTitle></CardHeader>
        <CardContent>
          {(subscriptions.data?.items ?? []).length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">You have no subscriptions yet.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {subscriptions.data?.items.map((subscription) => (
                <div key={subscription.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{subscription.planName}</p>
                    <p className="text-[10px] text-muted-foreground">Merchant {subscription.merchantId.slice(-8)} · {formatDateTime(subscription.createdAt)}</p>
                  </div>
                  <span className="rounded-md bg-secondary px-2 py-1 text-[10px] font-medium">{subscription.status.replaceAll("_", " ")}</span>
                  <p className="text-sm font-semibold">{formatMoney(subscription.pricingSnapshot.amountMinor, subscription.pricingSnapshot.currency)}</p>
                  <Button size="sm" variant="ghost" asChild><Link href={`/subscriptions/${encodeURIComponent(subscription.id)}`}>View</Link></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
