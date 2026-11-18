"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { FinanceOperationsView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function ControlFinancePage() {
  const queryClient = useQueryClient();
  const operations = useQuery({ queryKey: ["control", "finance", "operations"], queryFn: () => apiFetch<FinanceOperationsView>("/api/control/finance/operations") });
  const jobs = useQuery({ queryKey: ["control", "finance", "jobs"], queryFn: () => apiFetch<{ items: Array<{ id: string; type: string; status: string; attempts: number; error: string | null; createdAt: string }> }>("/api/control/finance/jobs") });
  const risk = useQuery({ queryKey: ["control", "finance", "quality"], queryFn: () => apiFetch<{ items: Array<{ id: string; issueCode: string; severity: string; status: string; createdAt: string }> }>("/api/control/finance/data-quality") });
  const run = useMutation({
    mutationFn: () => apiFetch("/api/control/finance/run", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "finance"] }); toast.success("Finance worker completed"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Worker run failed"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Financial intelligence operations" description="Aggregation, forecasting and report-processing health. No customer financial details are shown." />
      <div className="mb-4"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>Run finance worker</Button></div>
      {operations.isLoading || jobs.isLoading || risk.isLoading ? <LoadingState /> : null}
      {operations.data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Aggregation snapshots" value={String(operations.data.snapshots)} />
          <Metric label="Forecasts" value={String(operations.data.forecasts)} />
          <Metric label="Open anomalies" value={String(operations.data.anomalies)} />
          <Metric label="Active insights" value={String(operations.data.insights)} />
          <Metric label="Failed report jobs" value={String(operations.data.failedReports)} />
          <Metric label="Data quality issues" value={String(operations.data.dataQualityIssues)} />
          <Metric label="Processing backlog" value={String(operations.data.processingBacklog)} />
          <Metric label="Reconciliation failures" value={String(operations.data.reconciliationFailures)} />
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Report jobs</CardTitle></CardHeader>
          <CardContent>
            {(jobs.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No report jobs.</p> : (
              <div className="divide-y divide-slate-100">
                {jobs.data?.items.slice(0, 30).map((job) => (
                  <div key={job.id} className="flex justify-between py-2 text-xs"><span>{job.type.replaceAll("_", " ")}</span><span className="text-slate-500">{job.status} · {job.attempts} tries · {formatDateTime(job.createdAt)}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Data quality events</CardTitle></CardHeader>
          <CardContent>
            {(risk.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No open data quality events.</p> : (
              <div className="divide-y divide-slate-100">
                {risk.data?.items.slice(0, 30).map((event) => (
                  <div key={event.id} className="flex justify-between py-2 text-xs"><span>{event.issueCode}</span><span className="text-slate-500">{event.severity} · {formatDateTime(event.createdAt)}</span></div>
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
