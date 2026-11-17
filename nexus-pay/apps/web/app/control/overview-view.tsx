"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type {
  AdminAuditView,
  AlertView,
  ControlOverview,
  LeaderTransitionView,
  PaymentOperationView,
} from "@nexus/shared-types";
import { Activity, CheckCircle2, Radio, Users } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

export function OverviewView() {
  const overview = useQuery({
    queryKey: ["control", "overview"],
    queryFn: () => apiFetch<ControlOverview>("/api/control/overview"),
    refetchInterval: 30_000,
  });
  const transitions = useQuery({
    queryKey: ["control", "leader-history"],
    queryFn: () => apiFetch<{ items: LeaderTransitionView[] }>("/api/control/leader-history"),
  });
  const alerts = useQuery({
    queryKey: ["control", "alerts"],
    queryFn: () => apiFetch<{ items: AlertView[] }>("/api/control/alerts"),
  });
  const payments = useQuery({
    queryKey: ["control", "payments"],
    queryFn: () => apiFetch<{ items: PaymentOperationView[] }>("/api/control/payments"),
  });
  const audit = useQuery({
    queryKey: ["control", "audit"],
    queryFn: () => apiFetch<{ items: AdminAuditView[] }>("/api/control/audit"),
  });

  const data = overview.data;
  const healthTone =
    data?.health === "HEALTHY" ? "healthy" : data?.health === "UNKNOWN" ? "neutral" : data?.health === "QUORUM_LOST" || data?.health === "NO_LEADER" ? "critical" : "warning";

  return (
    <div>
      <ControlPageHeader
        eyebrow="Fleet status"
        title="Cluster overview"
        description="Live observations from the five-node Raftline development cluster. Unexposed metrics are labelled unavailable."
      />

      {overview.isError ? (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>
            {overview.error instanceof ApiClientError ? overview.error.message : "Cluster status could not be collected."}
          </AlertDescription>
        </Alert>
      ) : null}
      {overview.isLoading ? <LoadingState label="Probing cluster nodes…" /> : null}

      {data ? (
        <>
          {data.stale ? (
            <Alert variant="warning" className="mb-5">
              <AlertDescription>Showing the last stored snapshot; current probes are failing.</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Cluster health</p>
              <div className="mt-2"><StatusPill state={data.health.replaceAll("_", " ")} tone={healthTone} /></div>
              <p className="mt-2 text-[11px] text-slate-500">Last update {formatDateTime(data.lastStatusUpdate)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Nodes healthy</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{data.healthyNodes} / {data.configuredNodes}</p>
              <p className="mt-1 text-[11px] text-slate-500">{data.unavailableNodes} unavailable · quorum {data.quorum}</p>
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Current leader</p>
              <p className="mt-2 font-mono text-lg font-semibold text-slate-900">{data.leaderId ?? "None"}</p>
              <p className="mt-1 text-[11px] text-slate-500">{data.followers.length} followers observed</p>
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Raft term</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{data.term ?? "Not available"}</p>
              <p className="mt-1 text-[11px] text-slate-500">Commit {data.commitIndex ?? "N/A"} · applied {data.appliedIndex ?? "N/A"}</p>
            </CardContent></Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Node status</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/control/nodes">All nodes</Link></Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.nodes.map((node) => (
                    <Link key={node.nodeId} href={`/control/nodes/${encodeURIComponent(node.nodeId)}`} className="rounded-xl border border-slate-200 p-3 transition-colors hover:border-blue-300">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-slate-900">{node.nodeId}</span>
                        <StatusPill
                          state={node.health}
                          tone={node.health === "HEALTHY" ? "healthy" : node.health === "UNAVAILABLE" ? "critical" : "neutral"}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {node.role ?? "Unknown role"} {node.isLeader ? "· leader" : ""}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {node.responseTimeMs} ms · {node.commitIndex ?? "N/A"}
                      </p>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-slate-400">
                  Replication progress: {data.replicationProgress} · Chaos active: {data.chaosActive ? "yes" : "no"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Open alerts</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/control/alerts">View all</Link></Button>
              </CardHeader>
              <CardContent>
                {(alerts.data?.items ?? []).filter((alert) => alert.status !== "RESOLVED").length === 0 ? (
                  <p className="flex items-center gap-2 py-6 text-xs text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> No active incidents.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {alerts.data?.items.filter((alert) => alert.status !== "RESOLVED").slice(0, 5).map((alert) => (
                      <div key={alert.id} className="rounded-lg border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-slate-900">{alert.title}</p>
                          <StatusPill state={alert.severity} tone={alert.severity === "CRITICAL" ? "critical" : "warning"} />
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">{formatDateTime(alert.lastObservedAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-sm"><Radio className="h-4 w-4" /> Leader transitions</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/control/leader-elections">Timeline</Link></Button>
              </CardHeader>
              <CardContent>
                {(transitions.data?.items ?? []).length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">No transitions observed yet.</p>
                ) : (
                  <div className="space-y-2">
                    {transitions.data?.items.slice(0, 5).map((event) => (
                      <div key={event.id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">{event.fromLeaderId ?? "none"} → <strong>{event.toLeaderId ?? "none"}</strong></span>
                        <span className="text-[10px] text-slate-400">{formatDateTime(event.observedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> Recent payments</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/control/payments">Investigate</Link></Button>
              </CardHeader>
              <CardContent>
                {(payments.data?.items ?? []).length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">No payment operations yet.</p>
                ) : (
                  <div className="space-y-2">
                    {payments.data?.items.slice(0, 5).map((payment) => (
                      <div key={payment.intentId} className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-slate-700">{formatMoney(payment.amountMinor, payment.currency)}</span>
                        <StatusPill state={payment.status} tone={payment.status === "SETTLED" ? "healthy" : "warning"} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" /> Recent admin activity</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href="/control/audit">Audit</Link></Button>
              </CardHeader>
              <CardContent>
                {(audit.data?.items ?? []).length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">No administrative activity yet.</p>
                ) : (
                  <div className="space-y-2">
                    {audit.data?.items.slice(0, 5).map((event) => (
                      <div key={event.id} className="flex items-center justify-between text-xs">
                        <span className="truncate text-slate-700">{event.action.replaceAll("_", " ")}</span>
                        <span className="text-[10px] text-slate-400">{formatDateTime(event.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
