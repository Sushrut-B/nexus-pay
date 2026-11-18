"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

interface Row {
  id: string; userEmail: string; campaignName: string; transactionRef: string;
  amountMinor: number; status: string; paymentRef: string | null;
  failureCategory: string | null; createdAt: string;
}

export default function ControlCashbackPage() {
  const rows = useQuery({ queryKey: ["control", "rewards", "cashback"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/rewards/cashback") });
  return (
    <div>
      <ControlPageHeader eyebrow="Rewards" title="Cashback operations" description="Entitlements and their verified settlement references. No manual success marking." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Entitlements</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No cashback entitlements.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{row.userEmail} · {row.campaignName}</p>
                    <p className="text-[10px] text-slate-500">{row.transactionRef} · {formatDateTime(row.createdAt)}{row.paymentRef ? ` · ${row.paymentRef.slice(0, 14)}…` : ""}</p>
                  </div>
                  <p className="text-xs font-semibold">{formatMoney(row.amountMinor, "INR")}</p>
                  <StatusPill state={row.status.replaceAll("_", " ")} tone={row.status === "CREDITED" ? "healthy" : row.status === "FAILED" ? "critical" : "warning"} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
