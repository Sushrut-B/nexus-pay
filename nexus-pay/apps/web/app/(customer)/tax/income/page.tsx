"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { TaxIncomeView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function TaxIncomePage() {
  const queryClient = useQueryClient();
  const [fy] = useState("2025-26");
  const income = useQuery({ queryKey: ["tax", "income", fy], queryFn: () => apiFetch<{ items: TaxIncomeView[] }>(`/api/tax/income?financialYear=${fy}`) });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["tax", "income", fy] }); void queryClient.invalidateQueries({ queryKey: ["tax", "dashboard"] }); };
  const consolidate = useMutation({
    mutationFn: () => apiFetch<{ consolidated: number }>("/api/tax/consolidate", { method: "POST", body: JSON.stringify({ financialYear: fy }) }),
    onSuccess: (result: { consolidated?: number }) => { refresh(); toast.success(`Consolidated ${result.consolidated ?? 0} records`); },
  });
  const confirm = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/tax/income/${id}`, { method: "PATCH", body: JSON.stringify({ userConfirmed: true }) }),
    onSuccess: refresh,
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Income</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Income summary & classification</h1>
      </div>
      <Alert><AlertDescription>A wallet transfer is not automatically income. Records are derived from your existing financial data with source attribution and await your review.</AlertDescription></Alert>
      <Button size="sm" variant="outline" disabled={consolidate.isPending} onClick={() => consolidate.mutate()}>Consolidate FY {fy} records</Button>
      <Card>
        <CardHeader><CardTitle className="text-base">Records ({(income.data?.items ?? []).length})</CardTitle></CardHeader>
        <CardContent>
          {(income.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No tax income records yet.</p> : (
            <div className="divide-y divide-border/70">
              {income.data?.items.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{row.description}</p>
                    <p className="text-xs text-muted-foreground">{row.category} · {row.classification} · {row.sourceModule} · {row.userConfirmed ? "confirmed" : "needs review"}</p>
                    {row.assumptions ? <p className="text-[11px] text-amber-700">{row.assumptions}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{formatMoney(row.amountMinor, "INR")}</span>
                    {!row.userConfirmed ? <Button size="sm" variant="ghost" onClick={() => confirm.mutate(row.id)}>Confirm</Button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

