"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

interface Row {
  id: string; transactionRef: string; amountMinor: number; currency: string;
  status: string; paymentRef: string | null; failureCategory: string | null; createdAt: string;
}

export default function CashbackPage() {
  const rows = useQuery({ queryKey: ["rewards", "cashback"], queryFn: () => apiFetch<{ items: Row[] }>("/api/rewards/cashback") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Wallet credits</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Cashback history</h1>
      </div>
      <Alert><AlertDescription>Cashback is a sandbox promotional wallet credit settled through the existing Raftline-backed funding flow. It is separate from reward points.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Entitlements</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No cashback yet.</p> : (
            <div className="divide-y divide-border/70">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{formatMoney(row.amountMinor, row.currency)}</p>
                    <p className="text-[10px] text-muted-foreground">{row.transactionRef} · {formatDateTime(row.createdAt)}</p>
                  </div>
                  <span className="rounded-md bg-secondary px-2 py-1 text-[10px]">{row.status.replaceAll("_", " ")}</span>
                  {row.paymentRef ? <span className="font-mono text-[10px] text-muted-foreground">{row.paymentRef.slice(0, 12)}…</span> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
