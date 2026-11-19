"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { InsuranceActivityView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function InsuranceDocumentsPage() {
  const activity = useQuery({ queryKey: ["insurance", "activity"], queryFn: () => apiFetch<{ items: InsuranceActivityView[] }>("/api/insurance/activity") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Documents & activity</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Insurance document centre</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {(activity.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No activity yet.</p> : (
            <div className="divide-y divide-border/70">
              {activity.data?.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{item.title}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
