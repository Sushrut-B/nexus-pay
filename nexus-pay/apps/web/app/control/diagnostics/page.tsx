"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, DataRow, LoadingState, StatusPill } from "@/components/control/ui";

interface DiagnosticEntry {
  id: string; service: string; severity: string; operation: string; outcome: string;
  summary: string; correlationId: string | null; timestamp: string;
}

export default function DiagnosticsPage() {
  const diagnostics = useQuery({
    queryKey: ["control", "diagnostics"],
    queryFn: () => apiFetch<{ items: DiagnosticEntry[]; unresolvedReconciliations: number; note: string }>("/api/control/diagnostics"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Troubleshooting" title="Diagnostics" description={diagnostics.data?.note ?? "Structured observations only."} />
      {diagnostics.isLoading ? <LoadingState /> : null}
      {diagnostics.data ? (
        <>
          <Card className="mb-5">
            <CardContent className="p-5">
              <DataRow label="Unresolved reconciliation cases" value={diagnostics.data.unresolvedReconciliations} />
              <DataRow label="No native tracing" value="Structured logging and correlation IDs only" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Recent structured events</CardTitle></CardHeader>
            <CardContent>
              {(diagnostics.data.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No diagnostic events.</p> : (
                <div className="divide-y divide-slate-100">
                  {diagnostics.data.items.map((item) => (
                    <div key={`${item.service}-${item.id}`} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-medium text-slate-900">{item.operation} · {item.service}</p>
                        <StatusPill state={item.severity} tone={item.severity === "error" ? "critical" : "warning"} />
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{item.summary}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {item.outcome} · {item.correlationId ?? "no correlation id"} · {formatDateTime(item.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
