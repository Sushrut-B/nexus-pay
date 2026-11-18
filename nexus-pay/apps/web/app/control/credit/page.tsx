"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { CreditOperationsView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlCreditPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "credit"], queryFn: () => apiFetch<CreditOperationsView>("/api/control/credit/overview") });
  const applications = useQuery({ queryKey: ["control", "credit", "applications"], queryFn: () => apiFetch<{ items: Array<{ id: string; status: string; provider: { displayName: string }; createdAt: string }> }>("/api/control/credit/applications") });
  const events = useQuery({ queryKey: ["control", "credit", "events"], queryFn: () => apiFetch<{ items: Array<{ id: string; eventType: string; status: string; createdAt: string }> }>("/api/control/credit/events") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/credit/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "credit"] }); toast.success("Provider sync completed"); },
    onError: () => toast.error("Provider sync failed"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Credit operations" description="Provider integration health only. Applicant identity and document contents are not exposed." />
      <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run provider sync</Button></div>
      {overview.isLoading || applications.isLoading || events.isLoading ? <LoadingState /> : null}
      {overview.data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Providers" value={String(overview.data.providers)} />
          <Metric label="Products" value={String(overview.data.products)} />
          <Metric label="Active offers" value={String(overview.data.activeOffers)} />
          <Metric label="Applications" value={String(overview.data.applications)} />
          <Metric label="In progress" value={String(overview.data.submittedApplications)} />
          <Metric label="Callback failures" value={String(overview.data.callbackFailures)} />
          <Metric label="Document failures" value={String(overview.data.documentFailures)} />
          <Metric label="Sync backlog" value={String(overview.data.syncBacklog)} />
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Applications</CardTitle></CardHeader>
          <CardContent>
            {(applications.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No applications.</p> : (
              <div className="divide-y divide-slate-100">
                {applications.data?.items.slice(0, 30).map((row) => (
                  <div key={row.id} className="flex justify-between py-2 text-xs"><span>{row.provider.displayName}</span><span className="text-slate-500">{row.status} · {formatDateTime(row.createdAt)}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Provider events</CardTitle></CardHeader>
          <CardContent>
            {(events.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No events.</p> : (
              <div className="divide-y divide-slate-100">
                {events.data?.items.slice(0, 30).map((row) => (
                  <div key={row.id} className="flex justify-between py-2 text-xs"><span>{row.eventType}</span><span className="text-slate-500">{row.status} · {formatDateTime(row.createdAt)}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
