"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, DataRow, LoadingState, StatusPill } from "@/components/control/ui";

interface NodeDetail {
  node: {
    nodeId: string; httpUrl: string; grpcPort: number; reachable: boolean; role: string | null;
    term: number | null; commitIndex: number | null; lastApplied: number | null;
    responseTimeMs: number | null; lastSuccessfulCheck: string | null; observedAt: string;
    error: string | null; isLeader: boolean; health: string;
  };
  history: Array<{ at: string; reachable: boolean; role: string | null; term: number | null; responseTimeMs: number; error: string | null }>;
  chaos: { isPaused: boolean; isolatedPeers: string[]; recentEvents: Array<{ id: string; scenario: string; target: string; details: string; timestamp: string; active: boolean }> } | null;
  verify: { status?: unknown; summary?: unknown } | null;
}

export function NodeDetailView({ nodeId }: { nodeId: string }) {
  const detail = useQuery({
    queryKey: ["control", "node", nodeId],
    queryFn: () => apiFetch<NodeDetail>(`/api/control/nodes/${encodeURIComponent(nodeId)}`),
    refetchInterval: 30_000,
  });
  const data = detail.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Node details" title={nodeId} description="Live status, observed history and chaos state." />
      {detail.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Current state</CardTitle></CardHeader>
            <CardContent>
              <DataRow label="Health" value={<StatusPill state={data.node.health} tone={data.node.health === "HEALTHY" ? "healthy" : data.node.health === "UNAVAILABLE" ? "critical" : "neutral"} />} />
              <DataRow label="HTTP endpoint" value={data.node.httpUrl} />
              <DataRow label="gRPC port" value={data.node.grpcPort} />
              <DataRow label="Role" value={`${data.node.role ?? "Not available"}${data.node.isLeader ? " (leader)" : ""}`} />
              <DataRow label="Term" value={data.node.term ?? "Not available"} />
              <DataRow label="Commit index" value={data.node.commitIndex ?? "Not available"} />
              <DataRow label="Applied index" value={data.node.lastApplied ?? "Not available"} />
              <DataRow label="Response time" value={`${data.node.responseTimeMs} ms`} />
              <DataRow label="Last successful check" value={formatDateTime(data.node.lastSuccessfulCheck)} />
              <DataRow label="Last error" value={data.node.error ?? "None"} />
              <DataRow label="Uptime" value="Not available" />
              <DataRow label="Replication lag" value="Not available" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Observed history</CardTitle></CardHeader>
            <CardContent>
              {data.history.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No samples collected.</p> : (
                <div className="space-y-2">
                  {data.history.slice(0, 12).map((item) => (
                    <div key={item.at} className="flex items-center justify-between border-b border-slate-100 py-2 text-xs last:border-0">
                      <span className="text-slate-700">{item.role ?? "unknown"} · {item.responseTimeMs} ms</span>
                      <span className="text-[10px] text-slate-400">{formatDateTime(item.at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] text-slate-400">Events are sampled observations, not native Raftline events.</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">Chaos state</CardTitle></CardHeader>
            <CardContent>
              {data.chaos ? (
                <>
                  <DataRow label="Paused" value={data.chaos.isPaused ? "Yes" : "No"} />
                  <DataRow label="Isolated peers" value={data.chaos.isolatedPeers.join(", ") || "None"} />
                  <div className="mt-3 space-y-2">
                    {data.chaos.recentEvents.slice(0, 5).map((event) => (
                      <div key={event.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <p className="font-medium text-slate-900">{event.scenario} → {event.target}</p>
                        <p className="text-[10px] text-slate-500">{event.details} · {formatDateTime(event.timestamp)}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="py-6 text-center text-xs text-slate-500">Chaos status unavailable.</p>}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
