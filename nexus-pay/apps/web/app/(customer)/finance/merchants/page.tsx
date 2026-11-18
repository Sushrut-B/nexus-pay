"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { MerchantSpendView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function MerchantAnalyticsPage() {
  const merchants = useQuery({ queryKey: ["finance", "merchants"], queryFn: () => apiFetch<{ items: MerchantSpendView[] }>("/api/finance/merchants?period=month") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Spending intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Merchant analytics</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Where you spend</CardTitle></CardHeader>
        <CardContent>
          {(merchants.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No merchant spending recorded.</p> : (
            <div className="divide-y divide-border/70">
              {merchants.data?.items.map((merchant) => (
                <div key={merchant.merchant} className="flex items-center justify-between py-3 text-sm">
                  <span>{merchant.merchant} <span className="text-xs text-muted-foreground">· {merchant.transactionCount} payments</span></span>
                  <span className="font-semibold">{formatMoney(merchant.amountMinor, "INR")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
