"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ControlAccountsView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlAccountsPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "accounts"], queryFn: () => apiFetch<ControlAccountsView>("/api/control/accounts/overview") });
  const jobs = useQuery({ queryKey: ["control", "accounts", "jobs"], queryFn: () => apiFetch<{ items: Array<{ id: string; status: string; attempts: number; error: string | null }> }>("/api/control/accounts/jobs") });
  const health = useQuery({ queryKey: ["control", "accounts", "health"], queryFn: () => apiFetch<{ items: Array<{ id: string; status: string; latencyMs: number | null; capturedAt: string }> }>("/api/control/accounts/health") });
  const run = useMutation({
    mutationFn: (retryFailed: boolean) => apiFetch("/api/control/accounts/run", { method: "POST", body: JSON.stringify({ retryFailed }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "accounts"] }); toast.success("Worker completed"); },
    onError: () => toast.error("Worker run failed"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="External account operations" description="Provider and synchronisation health only. Full account identifiers and customer financial details are not exposed." />
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(false)}>Run sync worker</Button>
        <Button size="sm" variant="ghost" disabled={run.isPending} onClick={() => run.mutate(true)}>Retry failed jobs</Button>
      </div>
      {overview.isLoading || jobs.isLoading || health.isLoading ? <LoadingState /> : null}
      {overview.data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Providers" value={String(overview.data.providers)} />
          <Metric label="Connections" value={String(overview.data.connections)} />
          <Metric label="Active consents" value={String(overview.data.activeConsents)} />
          <Metric label="Revoked consents" value={String(overview.data.revokedConsents)} />
          <Metric label="Failed jobs" value={String(overview.data.failedJobs)} />
          <Metric label="Import backlog" value={String(overview.data.importBacklog)} />
          <Metric label="Duplicate events" value={String(overview.data.duplicateEvents)} />
          <Metric label="Callback failures" value={String(overview.data.callbackFailures)} />
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Failed sync jobs</CardTitle></CardHeader>
          <CardContent>
            {(jobs.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No failed jobs.</p> : (
              <div className="divide-y divide-slate-100">
                {jobs.data?.items.slice(0, 30).map((job) => (
                  <div key={job.id} className="flex justify-between py-2 text-xs"><span>{job.status}</span><span className="text-slate-500">{job.attempts} tries · {job.error?.slice(0, 40)}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Provider health</CardTitle></CardHeader>
          <CardContent>
            {(health.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No health checks yet.</p> : (
              <div className="divide-y divide-slate-100">
                {health.data?.items.slice(0, 30).map((row) => (
                  <div key={row.id} className="flex justify-between py-2 text-xs"><span>{row.status}</span><span className="text-slate-500">{row.latencyMs ?? "—"}ms · {formatDateTime(row.capturedAt)}</span></div>
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
