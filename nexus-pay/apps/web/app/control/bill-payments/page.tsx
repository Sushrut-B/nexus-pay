"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { BillOperationsView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

export default function ControlBillPaymentsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "billing"], queryFn: () => apiFetch<BillOperationsView>("/api/control/bill-payments/overview") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/bill-payments/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "billing"] }); toast.success("Biller sync and reminders processed"); },
  });
  const data = overview.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Bill payments operations" description="Provider health and measured payment data. No operator can fabricate biller confirmation." />
      {overview.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <Alert className="mb-4"><AlertDescription>Wallet settlement and biller confirmation are tracked separately. Only provider-confirmed payments are reported as paid.</AlertDescription></Alert>
          <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run biller sync & reminders</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Providers" value={String(data.providers)} />
            <Metric label="Available" value={String(data.availableProviders)} />
            <Metric label="Billers" value={String(data.billers)} />
            <Metric label="Payments" value={String(data.payments)} />
            <Metric label="Confirmed" value={String(data.confirmedPayments)} />
            <Metric label="Recharges" value={String(data.recharges)} />
            <Metric label="Unknown outcomes" value={String(data.unknownOutcomes)} />
            <Metric label="Reconciliation cases" value={String(data.reconciliationCases)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}

