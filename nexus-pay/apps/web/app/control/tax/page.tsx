"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { TaxOperationsView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

export default function ControlTaxPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "tax"], queryFn: () => apiFetch<TaxOperationsView>("/api/control/tax/overview") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/tax/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "tax"] }); toast.success("Tax worker processed"); },
  });
  const data = overview.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Tax operations" description="Processing health and rule governance only. Operators cannot alter user tax records or submit returns." />
      {overview.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <Alert className="mb-4"><AlertDescription>Operators cannot change user tax records, valuations or filing state. Tax estimates are never official assessments.</AlertDescription></Alert>
          <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run tax worker</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Rule sets" value={String(data.ruleSets)} />
            <Metric label="Published" value={String(data.publishedRuleSets)} />
            <Metric label="Calculations" value={String(data.calculations)} />
            <Metric label="Failed jobs" value={String(data.failedJobs)} />
            <Metric label="Documents" value={String(data.documents)} />
            <Metric label="Failed documents" value={String(data.failedDocuments)} />
            <Metric label="Reconciliation exceptions" value={String(data.reconciliationExceptions)} />
            <Metric label="Reminders sent" value={String(data.remindersSent)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}

