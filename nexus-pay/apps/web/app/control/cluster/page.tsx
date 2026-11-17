"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ControlOverview } from "@nexus/shared-types";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { ControlPageHeader, DataRow, LoadingState, StatusPill } from "@/components/control/ui";

export default function ClusterPage() {
  const cluster = useQuery({
    queryKey: ["control", "cluster"],
    queryFn: () => apiFetch<ControlOverview>("/api/control/cluster/status"),
    refetchInterval: 30_000,
  });
  const data = cluster.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Raftline" title="Cluster status" description="Observed from direct HTTP probes of all five configured nodes." />
      <div className="mb-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void cluster.refetch()} disabled={cluster.isFetching}>
          <RefreshCw className={`h-4 w-4 ${cluster.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {cluster.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Cluster state</CardTitle></CardHeader>
            <CardContent>
              <DataRow label="Health" value={<StatusPill state={data.health.replaceAll("_", " ")} tone={data.health === "HEALTHY" ? "healthy" : data.health === "UNKNOWN" ? "neutral" : "warning"} />} />
              <DataRow label="Leader" value={data.leaderId ?? "None observed"} />
              <DataRow label="Followers" value={data.followers.join(", ") || "None observed"} />
              <DataRow label="Term" value={data.term ?? "Not available"} />
              <DataRow label="Commit index" value={data.commitIndex ?? "Not available"} />
              <DataRow label="Applied index" value={data.appliedIndex ?? "Not available"} />
              <DataRow label="Replication progress" value={data.replicationProgress} />
              <DataRow label="Quorum" value={`${data.quorum} of ${data.configuredNodes}`} />
              <DataRow label="Last status update" value={formatDateTime(data.lastStatusUpdate)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Node observations</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.nodes.map((node) => (
                  <div key={node.nodeId} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div>
                      <p className="font-mono text-xs font-semibold">{node.nodeId}</p>
                      <p className="text-[10px] text-slate-500">{node.role ?? "unknown"} · {node.responseTimeMs} ms</p>
                    </div>
                    <StatusPill state={node.health} tone={node.health === "HEALTHY" ? "healthy" : node.health === "UNAVAILABLE" ? "critical" : "neutral"} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
