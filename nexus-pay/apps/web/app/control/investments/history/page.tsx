"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface HistoryRow { id: string; connectionId: string; status: string; accountsSeen: number; holdingsSeen: number; transactionsSeen: number; startedAt: string; finishedAt: string | null }

export default function ControlInvestmentHistoryPage() {
  const rows = useQuery({ queryKey: ["control", "investments", "history"], queryFn: () => apiFetch<{ items: HistoryRow[] }>("/api/control/investments/history") });
  return (
    <div>
      <ControlPageHeader eyebrow="Investments" title="Synchronization history" description="Measured import results per provider synchronization run." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">History</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No history yet.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-2 text-xs">
                  <span>{row.status} · {row.accountsSeen} accounts · {row.holdingsSeen} holdings · {row.transactionsSeen} transactions</span>
                  <span className="text-slate-500">{new Date(row.startedAt).toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
