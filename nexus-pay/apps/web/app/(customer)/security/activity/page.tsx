"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SecurityEventView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function SecurityActivityPage() {
  const query = useQuery({
    queryKey: ["security", "activity"],
    queryFn: () => apiFetch<{ items: SecurityEventView[] }>("/api/security/activity"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Activity</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Recent security activity</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Event timeline</CardTitle></CardHeader>
        <CardContent>
          {(query.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recent security events.</p> : (
            <ol className="space-y-3">
              {query.data?.items.map((event) => (
                <li key={event.id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                  <span className="font-medium">{event.type.replaceAll("_", " ")}</span>
                  <span className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString("en-IN")}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
