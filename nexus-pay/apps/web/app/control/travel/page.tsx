"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import type { TravelOperationsView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

export default function ControlTravelPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "travel"], queryFn: () => apiFetch<TravelOperationsView>("/api/control/travel/overview") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/travel/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "travel"] }); toast.success("Travel sync processed"); },
  });
  const data = overview.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Travel operations" description="Provider health and measured booking state. No operator can fabricate confirmation or refunds." />
      {overview.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <Alert className="mb-4"><AlertDescription>Wallet settlement and provider booking confirmation are tracked separately. Only verified provider events change booking state.</AlertDescription></Alert>
          <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run provider sync</Button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Providers" value={String(data.providers)} />
            <Metric label="Available" value={String(data.availableProviders)} />
            <Metric label="Searches" value={String(data.searches)} />
            <Metric label="Bookings" value={String(data.bookings)} />
            <Metric label="Confirmed" value={String(data.confirmedBookings)} />
            <Metric label="Unknown outcomes" value={String(data.unknownOutcomes)} />
            <Metric label="Reconciliation cases" value={String(data.reconciliationCases)} />
            <Metric label="Last sync" value={data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString("en-IN") : "—"} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
