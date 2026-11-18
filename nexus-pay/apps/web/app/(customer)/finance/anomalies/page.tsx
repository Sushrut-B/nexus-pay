"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { AnomalyView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function AnomaliesPage() {
  const queryClient = useQueryClient();
  const anomalies = useQuery({ queryKey: ["finance", "anomalies"], queryFn: () => apiFetch<{ items: AnomalyView[] }>("/api/finance/anomalies") });
  const feedback = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/api/finance/anomalies/${encodeURIComponent(id)}/feedback`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance", "anomalies"] }); toast.success("Feedback recorded"); },
    onError: () => toast.error("Could not record feedback"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Spending anomalies</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Unusual spending</h1>
      </div>
      <Alert><AlertDescription>These are informational deviations from your own baseline. They are not fraud determinations.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Detected deviations</CardTitle></CardHeader>
        <CardContent>
          {(anomalies.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No anomalies detected.</p> : (
            <div className="divide-y divide-border/70">
              {anomalies.data?.items.map((item) => (
                <div key={item.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.category.replaceAll("_", " ")} · {item.severity}</p>
                    <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.reason}</p>
                  <p className="text-xs">Baseline {formatMoney(item.baselineMinor, "INR")} · observed {formatMoney(item.observedMinor, "INR")}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" disabled={feedback.isPending} onClick={() => feedback.mutate({ id: item.id, status: "EXPECTED" })}>Expected</Button>
                    <Button size="sm" variant="ghost" disabled={feedback.isPending} onClick={() => feedback.mutate({ id: item.id, status: "DISMISSED" })}>Dismiss</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
