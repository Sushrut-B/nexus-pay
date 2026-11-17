"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { MetricsView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { useState } from "react";
import { ControlPageHeader, DataRow, LoadingState } from "@/components/control/ui";

export default function MetricsPage() {
  const [range, setRange] = useState("day");
  const metrics = useQuery({
    queryKey: ["control", "metrics", range],
    queryFn: () => apiFetch<MetricsView>(`/api/control/metrics?range=${range}`),
  });
  const data = metrics.data;
  return (
    <div>
      <ControlPageHeader eyebrow="Observability" title="Metrics" description="Nexus-observed measurements, not native Raftline metrics. Missing data is never interpolated." />
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {["hour", "day", "week", "month"].map((value) => (
          <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-md px-3 py-1.5 text-xs ${range === value ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            {value === "hour" ? "Last hour" : value === "day" ? "24 hours" : value === "week" ? "7 days" : "30 days"}
          </button>
        ))}
      </div>
      {metrics.isLoading ? <LoadingState /> : null}
      {data ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Measurements</CardTitle></CardHeader>
            <CardContent>
              <DataRow label="Samples" value={data.samples} />
              <DataRow label="Leader changes" value={data.leaderChanges} />
              <DataRow label="Settlements" value={data.paymentSettlements} />
              <DataRow label="Failures" value={data.paymentFailures} />
              <DataRow label="Success rate" value={data.successRate === null ? "Not available" : `${data.successRate}%`} />
              <DataRow label="Average node response" value={data.averageResponseMs === null ? "Not available" : `${data.averageResponseMs} ms`} />
              <DataRow label="Replication lag" value={data.replicationLag} />
              <DataRow label="Source" value={data.source} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Availability samples</CardTitle></CardHeader>
            <CardContent>
              {data.availability.length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No samples in this range.</p> : (
                <div className="space-y-2">
                  {data.availability.slice(-20).map((point) => (
                    <div key={point.at} className="flex items-center gap-3">
                      <span className="w-20 text-[10px] text-slate-500">{formatDateTime(point.at)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-emerald-500" style={{ width: `${point.percentage}%` }} />
                      </div>
                      <span className="w-16 text-right text-[11px] font-medium">{point.percentage}%</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
