"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { InvestmentOperationsView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

export default function ControlInvestmentsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "investments"], queryFn: () => apiFetch<InvestmentOperationsView>("/api/control/investments/overview") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/investments/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "investments"] }); toast.success("Investment sync processed"); },
  });
  const data = overview.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Investment operations" description="Provider health and measured synchronization state. No operator can edit holdings or execute trades." />
      {overview.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <Alert className="mb-4"><AlertDescription>Holdings are external snapshots. Operators cannot change valuations, ownership, consent or Raftline balances.</AlertDescription></Alert>
          <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run provider sync</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Providers" value={String(data.providers)} />
            <Metric label="Available" value={String(data.availableProviders)} />
            <Metric label="Connections" value={String(data.connections)} />
            <Metric label="Active" value={String(data.activeConnections)} />
            <Metric label="Failed sync jobs" value={String(data.syncJobsFailed)} />
            <Metric label="Holdings" value={String(data.holdings)} />
            <Metric label="Transactions" value={String(data.transactions)} />
            <Metric label="Stale holdings" value={String(data.staleHoldings)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
