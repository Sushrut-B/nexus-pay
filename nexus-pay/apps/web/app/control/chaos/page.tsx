"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label,
} from "@nexus/ui";
import type { ChaosOperationView, ChaosScenario, ControlOverview, NodeView } from "@nexus/shared-types";
import { CHAOS_SCENARIO_INFO, CHAOS_SCENARIOS } from "@nexus/shared-types";
import { AlertTriangle, HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { ControlPageHeader, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function ChaosPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["control", "overview"], queryFn: () => apiFetch<ControlOverview>("/api/control/overview") });
  const operations = useQuery({ queryKey: ["control", "chaos"], queryFn: () => apiFetch<{ items: ChaosOperationView[] }>("/api/control/chaos/operations") });

  const [nodeId, setNodeId] = useState("");
  const [scenario, setScenario] = useState<ChaosScenario>("PARTITION_NODE");
  const [reason, setReason] = useState("");
  const [peer, setPeer] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodes: NodeView[] = overview.data?.nodes ?? [];
  const info = CHAOS_SCENARIO_INFO[scenario];

  const inject = useMutation({
    mutationFn: () =>
      apiFetch<ChaosOperationView>("/api/control/chaos/inject", {
        method: "POST",
        body: JSON.stringify({
          nodeId,
          scenario,
          reason,
          ...(info.needsPeer && peer ? { peer } : {}),
        }),
      }),
    onSuccess: () => {
      setConfirming(false); setReason(""); setPeer(""); setError(null);
      void queryClient.invalidateQueries({ queryKey: ["control"] });
      toast.success("Chaos request executed and recorded");
    },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Chaos injection failed."),
  });

  const heal = useMutation({
    mutationFn: () =>
      apiFetch<ChaosOperationView>("/api/control/chaos/heal", {
        method: "POST",
        body: JSON.stringify({ nodeId, reason: reason || "Manual recovery", all: true }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["control"] });
      toast.success("Heal request accepted");
    },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Heal failed."),
  });

  return (
    <div>
      <ControlPageHeader
        eyebrow="Resilience testing"
        title="Chaos engineering"
        description="Executes real Raftline chaos endpoints. Destructive operations are safety-checked, rate-limited and fully audited."
      />

      {error ? <Alert variant="destructive" className="mb-5"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-600" /> Inject failure</CardTitle>
            <CardDescription>Select a node and a genuinely supported scenario.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="chaos-node">Target node</Label>
              <select id="chaos-node" value={nodeId} onChange={(e) => setNodeId(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                <option value="">Choose…</option>
                {nodes.map((node) => <option key={node.nodeId} value={node.nodeId}>{node.nodeId} — {node.role ?? "unknown"}{node.isLeader ? " (leader)" : ""}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="chaos-scenario">Failure mode</Label>
              <select id="chaos-scenario" value={scenario} onChange={(e) => setScenario(e.target.value as ChaosScenario)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                {CHAOS_SCENARIOS.map((value) => <option key={value} value={value}>{CHAOS_SCENARIO_INFO[value].label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">{info.impact}</p>
            </div>
            {info.needsPeer ? (
              <div>
                <Label htmlFor="chaos-peer">Target peer</Label>
                <Input id="chaos-peer" value={peer} onChange={(e) => setPeer(e.target.value)} placeholder="node-2" className="mt-1.5" />
              </div>
            ) : null}
            <div>
              <Label htmlFor="chaos-reason">Reason / incident reference</Label>
              <Input id="chaos-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="INC-1234 failover drill" className="mt-1.5" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={!nodeId || reason.trim().length < 5 || inject.isPending} onClick={() => setConfirming(true)}>
                Review injection
              </Button>
              <Button variant="outline" disabled={!nodeId || heal.isPending} onClick={() => heal.mutate()}>
                <HeartPulse className="h-4 w-4" /> Heal all faults
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Operation history</CardTitle></CardHeader>
          <CardContent>
            {operations.isLoading ? <LoadingState /> : null}
            {(operations.data?.items ?? []).length === 0 && !operations.isLoading ? (
              <EmptyState title="No chaos operations" message="Safety-checked operations will be listed here." />
            ) : null}
            <div className="space-y-2">
              {operations.data?.items.slice(0, 12).map((op) => (
                <div key={op.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-slate-900">{op.scenario} → {op.nodeId}</p>
                    <StatusPill state={op.status} tone={op.status === "INJECTED" || op.status === "HEALED" ? "healthy" : op.status === "BLOCKED" ? "warning" : "critical"} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{op.reason} · {formatDateTime(op.requestedAt)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Confirm chaos injection</CardTitle>
              <CardDescription>This will execute a real fault against {nodeId}. The action will be audited.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p><strong>Mode:</strong> {info.label}</p>
                <p><strong>Target:</strong> {nodeId}{peer ? ` → ${peer}` : ""}</p>
                <p><strong>Reason:</strong> {reason}</p>
                <p><strong>Impact:</strong> {info.impact}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button variant="destructive" className="flex-1" disabled={inject.isPending} onClick={() => inject.mutate()}>
                  {inject.isPending ? "Executing…" : "Confirm injection"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
