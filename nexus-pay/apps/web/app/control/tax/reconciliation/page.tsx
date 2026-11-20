"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Row { id: string; category: string; sourceRef: string; status: string }

export default function Page() {
  const rows = useQuery({ queryKey: ["control", "tax", "reconciliation"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/tax/reconciliation") });
  return (
    <div>
      <ControlPageHeader eyebrow="Tax" title="Reconciliation exceptions" description="Unmatched statement rows require review; nothing is removed automatically." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Reconciliation exceptions</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No records.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-2 text-xs">
                  <span>{row.category} - {row.sourceRef}</span>
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
