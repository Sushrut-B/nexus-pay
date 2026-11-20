"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

interface Operations {
  fxProviders: Array<{ code: string; displayName: string; available: boolean; notice: string }>;
  internationalProviders: Array<{ code: string; displayName: string; available: boolean; notice: string }>;
  rateFreshness: Array<{ pair: string; provider: string; classification: string; fetchedAt: string }>;
  jobs: Array<{ id: string; kind: string; status: string; attempts: number; lastError: string | null }>;
  failedJobs: number;
  webhooks: Array<{ id: string; providerCode: string; eventId: string; signatureVerified: boolean; processed: boolean }>;
  reconciliations: Array<{ id: string; transferId: string; outcome: string; resolvedBy: string | null }>;
  compliance: Array<{ id: string; kind: string; state: string }>;
  audit: Array<{ id: string; action: string; actorId: string; createdAt: string }>;
  notice: string;
}

export default function ControlGlobalPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["control", "global"], queryFn: () => apiFetch<Operations>("/api/control/global") });
  const [pause, setPause] = useState<{ code: string; kind: "fx" | "international"; paused: boolean } | null>(null);
  const pauseMutation = useMutation({
    mutationFn: () => apiFetch(`/api/control/global/providers/${pause!.code}`, { method: "POST", body: JSON.stringify({ kind: pause!.kind, paused: pause!.paused }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "global"] }); setPause(null); toast.success("Provider state updated"); },
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/global/jobs/${id}/retry`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "global"] }); toast.success("Read-only job requeued"); },
  });
  const data = query.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Ecosystem" title="Global Finance operations" description="Provider health, rate freshness, read-only sync jobs and reconciliation visibility. Operators cannot edit balances, rates or transfer outcomes without provider confirmation." />
      {query.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="space-y-5">
          <Alert><AlertDescription>{data.notice}</AlertDescription></Alert>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="FX providers" value={String(data.fxProviders.length)} />
            <Metric label="Intl. providers" value={String(data.internationalProviders.length)} />
            <Metric label="Failed jobs" value={String(data.failedJobs)} />
            <Metric label="Webhooks" value={String(data.webhooks.length)} />
          </div>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Providers</h2>
            {[...data.fxProviders, ...data.internationalProviders].map((p) => (
              <div key={p.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2 text-xs">
                <span>{p.displayName} Â· {p.available ? "AVAILABLE" : "UNAVAILABLE"}</span>
                <Button size="sm" variant="outline" onClick={() => setPause({ code: p.code, kind: data.fxProviders.some((f) => f.code === p.code) ? "fx" : "international", paused: p.available })}>{p.available ? "Pause" : "Resume"}</Button>
              </div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Rate freshness</h2>
            {data.rateFreshness.length === 0 ? <p className="text-xs text-slate-500">No rates synchronised.</p> : data.rateFreshness.map((r) => (
              <div key={`${r.pair}-${r.fetchedAt}`} className="flex justify-between border-b border-border/70 py-1 text-xs"><span>{r.pair} Â· {r.classification}</span><span className="text-slate-500">{r.provider} Â· {new Date(r.fetchedAt).toLocaleString("en-IN")}</span></div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Sync jobs</h2>
            {data.jobs.length === 0 ? <p className="text-xs text-slate-500">No jobs.</p> : data.jobs.map((j) => (
              <div key={j.id} className="flex justify-between border-b border-border/70 py-2 text-xs"><span>{j.kind} Â· {j.status} Â· attempts {j.attempts}</span><span>{j.lastError ? <span className="text-red-600">{j.lastError.slice(0, 60)}</span> : null}<Button className="ml-2" size="sm" variant="outline" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(j.id)}>Retry read-only</Button></span></div>
            ))}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-display text-base font-semibold text-slate-900">Reconciliation & compliance</h2>
            {data.reconciliations.map((r) => <div key={r.id} className="py-1 text-xs">{r.transferId} Â· {r.outcome} Â· by {r.resolvedBy ?? "system"}</div>)}
            {data.compliance.map((c) => <div key={c.id} className="py-1 text-xs">{c.kind} Â· {c.state}</div>)}
          </section>
          {pause ? <Button disabled={pauseMutation.isPending} onClick={() => pauseMutation.mutate()}>Confirm {pause.paused ? "pause" : "resume"}</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-card p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-semibold text-slate-900">{value}</p></div>;
}
