"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { TaxCapitalGainsSummary } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function TaxCapitalGainsPage() {
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: ["tax", "gains"], queryFn: () => apiFetch<TaxCapitalGainsSummary>("/api/tax/capital-gains") });
  const derive = useMutation({
    mutationFn: () => apiFetch("/api/tax/capital-gains/derive", { method: "POST", body: JSON.stringify({ financialYear: "2025-26" }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["tax", "gains"] }); },
  });
  const data = summary.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Capital gains</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Capital gains centre</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "Unrealized gains are not realized taxable gains. Cost basis and holding period must be verified before any figure is used in a tax estimate."}</AlertDescription></Alert>
      <Button size="sm" variant="outline" disabled={derive.isPending} onClick={() => derive.mutate()}>Derive candidates from investments</Button>
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Realized" value={formatMoney(data.realizedMinor, "INR")} />
          <Metric label="Unrealized" value={formatMoney(data.unrealizedMinor, "INR")} />
          <Metric label="Short-term" value={formatMoney(data.shortTermMinor, "INR")} />
          <Metric label="Long-term" value={formatMoney(data.longTermMinor, "INR")} />
        </div>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-base">Transaction-level records ({data?.items.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {(data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No candidate disposals derived yet.</p> : (
            <div className="divide-y divide-border/70">
              {data?.items.map((item) => (
                <div key={item.id} className="flex justify-between py-3 text-xs">
                  <span>{item.assetType} · {item.gainType} · {item.completeness}</span>
                  <span className="text-muted-foreground">{formatMoney(item.saleMinor, "INR")} · gain {formatMoney(item.gainMinor, "INR")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-semibold text-navy">{value}</p></div>;
}
