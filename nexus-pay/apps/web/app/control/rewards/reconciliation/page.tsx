"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { ReconciliationView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlReconciliationPage() {
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: ["control", "rewards", "reconciliation"], queryFn: () => apiFetch<ReconciliationView>("/api/control/rewards/reconciliation") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/rewards/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "rewards"] }); toast.success("Rewards worker completed"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Worker run failed"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Rewards" title="Reward reconciliation" description="Consistency checks across the points ledger, budgets and entitlements. No historical records are silently repaired." />
      <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run rewards worker</Button></div>
      {view.isLoading ? <LoadingState /> : null}
      {view.data ? (
        <>
          {view.data.discrepancies.length > 0 ? (
            <Alert variant="destructive" className="mb-4"><AlertDescription>{view.data.discrepancies.join("; ")}</AlertDescription></Alert>
          ) : (
            <Alert className="mb-4"><AlertDescription>No ledger inconsistencies detected.</AlertDescription></Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Points ledger" value={view.data.pointsLedgerBalance.toLocaleString("en-IN")} />
            <Metric label="Computed balance" value={view.data.computedBalance.toLocaleString("en-IN")} />
            <Metric label="Reserved budget" value={formatMoney(view.data.cashbackReservedMinor, "INR")} />
            <Metric label="Consumed budget" value={formatMoney(view.data.cashbackConsumedMinor, "INR")} />
            <Metric label="Pending entitlements" value={String(view.data.pendingEntitlements)} />
            <Metric label="Open reservations" value={String(view.data.openReservations)} />
            <Metric label="Referrals unrewarded" value={String(view.data.referralQualifiedUnrewarded)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}

