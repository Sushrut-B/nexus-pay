"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { GlobalDashboardView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { Empty, GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

export default function GlobalFinancePage() {
  const query = useQuery({ queryKey: ["global", "dashboard"], queryFn: () => apiFetch<GlobalDashboardView>("/api/global-finance/dashboard") });
  const data = query.data;
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Your money across currencies" description="Track, value and understand international activity. Converted figures are estimates at a stated source-attributed rate, never wallet balances." />
      <GlobalNav />
      <GlobalNotice>{data?.notice ?? "INR is the only transactable Nexus Pay wallet currency. Other currencies are tracked for valuation and planning only."}</GlobalNotice>
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Display currency" value={data.displayCurrency} />
            <Metric label="Total assets (est.)" value={formatMoney(data.totalAssetsMinor, data.displayCurrency)} />
            <Metric label="Foreign asset exposure" value={formatMoney(data.foreignAssetExposureMinor, data.displayCurrency)} />
            <Metric label="Foreign liabilities" value={formatMoney(data.foreignLiabilityExposureMinor, data.displayCurrency)} />
            <Metric label="Intl. expenses (est.)" value={formatMoney(data.recentInternationalExpenseMinor, data.displayCurrency)} />
            <Metric label="Travel spend (est.)" value={formatMoney(data.recentTravelSpendMinor, data.displayCurrency)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 font-display text-lg font-semibold text-navy">Currency allocation</h2>
              {data.currencyAllocation.length === 0 ? <Empty>No tracked balances yet.</Empty> : (
                <div className="space-y-2">
                  {data.currencyAllocation.map((item) => (
                    <div key={item.currency} className="flex items-center justify-between text-sm">
                      <span>{item.currency}</span>
                      <span className="text-muted-foreground">{formatMoney(item.minor, item.currency)} Â· {(item.percentBps / 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-3 font-display text-lg font-semibold text-navy">Recent rate movements</h2>
              {data.recentMovements.length === 0 ? <Empty>No rates synchronised. Enable a sandbox provider in Control.</Empty> : (
                <div className="space-y-2">
                  {data.recentMovements.map((rate) => (
                    <div key={rate.id} className="flex items-center justify-between text-sm">
                      <span>{rate.baseCurrency}/{rate.quoteCurrency}</span>
                      <span className="text-muted-foreground">{rate.rate} Â· {rate.classification}{rate.isStale ? " Â· STALE" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 font-display text-lg font-semibold text-navy">Linked and tracked accounts</h2>
            {data.accounts.length === 0 ? <Empty>No accounts tracked.</Empty> : (
              <div className="divide-y divide-border/70">
                {data.accounts.slice(0, 8).map((account) => (
                  <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{account.name} <span className="text-xs text-muted-foreground">({account.currency})</span></span>
                    <span className="text-right text-xs text-muted-foreground">{formatMoney(account.originalBalanceMinor, account.currency)} Â· {account.classification}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : <p className="text-sm text-muted-foreground">Loading global overviewâ€¦</p>}
    </div>
  );
}
