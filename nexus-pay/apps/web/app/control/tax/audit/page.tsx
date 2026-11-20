"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface Row { id: string; action: string; targetId: string; createdAt: string }

export default function Page() {
  const rows = useQuery({ queryKey: ["control", "tax", "audit"], queryFn: () => apiFetch<{ items: Row[] }>("/api/control/tax/audit") });
  return (
    <div>
      <ControlPageHeader eyebrow="Tax" title="Tax audit history" description="Every privileged tax action is recorded." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Tax audit history</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No records.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-2 text-xs">
                  <span>{row.action} - {row.targetId}</span>
                  <span className="text-slate-500">{new Date(row.createdAt).toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
