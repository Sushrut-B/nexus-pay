"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@nexus/ui";
import type { NodeView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function NodesPage() {
  const nodes = useQuery({
    queryKey: ["control", "nodes"],
    queryFn: () => apiFetch<{ items: NodeView[] }>("/api/control/nodes"),
    refetchInterval: 30_000,
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Fleet" title="Nodes" description="Availability and role are derived from live status probes. Click a node for details." />
      {nodes.isLoading ? <LoadingState /> : null}
      {(nodes.data?.items ?? []).length === 0 && !nodes.isLoading ? (
        <EmptyState title="No observations" message="Cluster monitoring has not collected a snapshot yet." />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nodes.data?.items.map((node) => (
          <Link key={node.nodeId} href={`/control/nodes/${encodeURIComponent(node.nodeId)}`}>
            <Card className="h-full transition-colors hover:border-blue-300">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm font-semibold text-slate-900">{node.nodeId}</p>
                  <StatusPill state={node.health} tone={node.health === "HEALTHY" ? "healthy" : node.health === "UNAVAILABLE" ? "critical" : "neutral"} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{node.role ?? "Unknown role"}{node.isLeader ? " · leader" : ""}</p>
                <div className="mt-4 space-y-1 text-[11px] text-slate-500">
                  <p>Term {node.term ?? "N/A"} · commit {node.commitIndex ?? "N/A"}</p>
                  <p>Response {node.responseTimeMs} ms</p>
                  <p>Last check {formatDateTime(node.lastSuccessfulCheck)}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
