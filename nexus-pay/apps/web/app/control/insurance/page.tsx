"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceOperationsView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlInsurancePage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "insurance"], queryFn: () => apiFetch<InsuranceOperationsView>("/api/control/insurance/overview") });
  const events = useQuery({ queryKey: ["control", "insurance", "events"], queryFn: () => apiFetch<{ items: Array<{ id: string; eventType: string; status: string; createdAt: string }> }>("/api/control/insurance/events") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/insurance/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "insurance"] }); toast.success("Provider sync completed"); },
    onError: () => toast.error("Provider sync failed"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Insurance operations" description="Provider integration health only. Applicant identity and policy documents are not exposed." />
      <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run provider sync</Button></div>
      {overview.isLoading || events.isLoading ? <LoadingState /> : null}
      {overview.data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Providers" value={String(overview.data.providers)} />
          <Metric label="Products" value={String(overview.data.products)} />
          <Metric label="Applications" value={String(overview.data.applications)} />
          <Metric label="Policies" value={String(overview.data.policies)} />
          <Metric label="Claims" value={String(overview.data.claims)} />
          <Metric label="Webhook failures" value={String(overview.data.webhookFailures)} />
          <Metric label="Sync backlog" value={String(overview.data.syncBacklog)} />
          <Metric label="Last sync" value={overview.data.lastSyncAt ? formatDateTime(overview.data.lastSyncAt) : "—"} />
        </div>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Provider events</CardTitle></CardHeader>
        <CardContent>
          {(events.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No provider events.</p> : (
            <div className="divide-y divide-slate-100">
              {events.data?.items.slice(0, 30).map((event) => (
                <div key={event.id} className="flex justify-between py-2 text-xs"><span>{event.eventType}</span><span className="text-slate-500">{event.status} · {formatDateTime(event.createdAt)}</span></div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
