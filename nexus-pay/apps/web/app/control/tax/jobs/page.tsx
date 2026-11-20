"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Job { id: string; kind: string; status: string; attempts: number }

export default function Page() {
  const rows = useQuery({ queryKey: ["control", "tax", "jobs"], queryFn: () => apiFetch<{ items: Job[] }>("/api/control/tax/jobs") });
  return (
    <div>
      <ControlPageHeader eyebrow="Tax" title="Processing jobs" description="Read-only job monitoring and retry." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Processing jobs</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No records.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-2 text-xs">
                  <span>{row.kind} - attempts {row.attempts}</span>
                  <span className="text-slate-500">{row.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
