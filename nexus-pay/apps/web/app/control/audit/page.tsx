"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { AdminAuditView } from "@nexus/shared-types";
import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState, StatusPill } from "@/components/control/ui";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const audit = useQuery({
    queryKey: ["control", "audit", action],
    queryFn: () => apiFetch<{ items: AdminAuditView[] }>(`/api/control/audit?action=${encodeURIComponent(action)}`),
  });
  const items = (audit.data?.items ?? []).filter((item) =>
    !action || item.action.toLowerCase().includes(action.toLowerCase()),
  );
  return (
    <div>
      <ControlPageHeader eyebrow="Compliance" title="Administrative audit" description="Append-only history of privileged actions. Records cannot be modified through the application." />
      <div className="mb-4">
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action" aria-label="Filter audit" className="h-9 w-64" />
      </div>
      {audit.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Events</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {items.slice(0, 100).map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-900">{item.action.replaceAll("_", " ")}</p>
                  <p className="text-[10px] text-slate-500">
                    {item.actorEmail ?? item.actorId ?? "system"} · {item.targetType}/{item.targetId} · {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {item.reason ? <p className="max-w-[240px] truncate text-[10px] text-slate-500">{item.reason}</p> : null}
                <StatusPill state={item.outcome} tone={item.outcome === "SUCCESS" ? "healthy" : item.outcome === "BLOCKED" ? "warning" : "critical"} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
