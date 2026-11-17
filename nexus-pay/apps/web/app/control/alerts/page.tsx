"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, Input } from "@nexus/ui";
import type { AlertView } from "@nexus/shared-types";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { ControlPageHeader, EmptyState, LoadingState, StatusPill } from "@/components/control/ui";

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ["control", "alerts"], queryFn: () => apiFetch<{ items: AlertView[] }>("/api/control/alerts"), refetchInterval: 30_000 });
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const acknowledge = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiFetch(`/api/control/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["control", "alerts"] });
      toast.success("Alert acknowledged");
    },
    onError: (error) => toast.error(error instanceof ApiClientError ? error.message : "Could not acknowledge alert."),
  });
  const items = (alerts.data?.items ?? []).filter((item) => !status || item.status === status);
  return (
    <div>
      <ControlPageHeader eyebrow="Incidents" title="Alerts" description="Deduplicated alerts derived from actual cluster observations." />
      <div className="mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter alerts" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs">
          <option value="">All states</option>
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>
      {alerts.isLoading ? <LoadingState /> : null}
      {items.length === 0 && !alerts.isLoading ? <EmptyState title="No alerts" message="No incidents match the current filter." /> : null}
      <div className="space-y-3">
        {items.map((alert) => (
          <Card key={alert.id}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                  <p className="mt-1 text-xs text-slate-600">{alert.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill state={alert.severity} tone={alert.severity === "CRITICAL" ? "critical" : alert.severity === "HIGH" ? "warning" : "info"} />
                  <StatusPill state={alert.status} tone={alert.status === "RESOLVED" ? "healthy" : "neutral"} />
                </div>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                First detected {formatDateTime(alert.firstDetectedAt)} · last observed {formatDateTime(alert.lastObservedAt)}
                {alert.nodeId ? ` · ${alert.nodeId}` : ""}
              </p>
              {alert.suggestedSteps ? <p className="mt-2 text-xs text-slate-600">Suggested: {alert.suggestedSteps}</p> : null}
              {alert.status !== "RESOLVED" ? (
                <div className="mt-3 flex gap-2">
                  <Input value={reason[alert.id] ?? ""} onChange={(e) => setReason((current) => ({ ...current, [alert.id]: e.target.value }))} placeholder="Optional acknowledgement reason" aria-label="Reason" className="h-9 w-64" />
                  <Button size="sm" variant="outline" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ id: alert.id, reason: reason[alert.id] })}>Acknowledge</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
