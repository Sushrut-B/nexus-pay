"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SecurityWarningView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function SecurityWarningsPage() {
  const queryClient = useQueryClient();
  const warnings = useQuery({ queryKey: ["security", "warnings"], queryFn: () => apiFetch<{ items: SecurityWarningView[] }>("/api/security/warnings") });
  const acknowledge = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/security/warnings/${encodeURIComponent(id)}/acknowledge`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "warnings"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Warnings</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Security warnings</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Notifications requiring your attention</CardTitle></CardHeader>
        <CardContent>
          {(warnings.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No current warnings.</p> : (
            <div className="divide-y divide-border/70">
              {warnings.data?.items.map((warning) => (
                <div key={warning.id} className="py-3 text-sm">
                  <p className="font-medium">{warning.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{warning.message}</p>
                  {!warning.acknowledged ? <button className="mt-2 text-xs text-primary underline" onClick={() => acknowledge.mutate(warning.id)}>Acknowledge</button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
