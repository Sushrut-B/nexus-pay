"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

export default function Page() {
  const query = useQuery({ queryKey: ["control", "fraud", "alerts"], queryFn: () => apiFetch<{ items: Array<Record<string, string | number>> }>("/api/control/fraud/alerts") });
  return (
    <div>
      <ControlPageHeader eyebrow="Fraud intelligence" title="Risk alerts" description="Authorized investigation view. Internal notes are not shown to customers." />
      {query.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Alert queue</CardTitle></CardHeader>
        <CardContent>
          {(query.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-slate-500">No records.</p> : (
            <div className="divide-y divide-slate-100">
              {query.data?.items.map((item: Record<string, string | number>, index: number) => (
                <div key={item.id ?? index} className="flex justify-between gap-4 py-2 text-xs">
                  <span>{item.title} · score {item.score}</span>
                  <span className="text-slate-500">{item.status ?? item.severity ?? item.category ?? ""}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


