"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { RecurringPatternView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function RecurringPage() {
  const queryClient = useQueryClient();
  const patterns = useQuery({ queryKey: ["finance", "recurring"], queryFn: () => apiFetch<{ items: RecurringPatternView[] }>("/api/finance/recurring") });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["finance", "recurring"] });
  const action = (id: string, path: string) => apiFetch(`/api/finance/recurring/${encodeURIComponent(id)}/${path}`, { method: "POST", body: "{}" });
  const confirm = useMutation({ mutationFn: (id: string) => action(id, "confirm"), onSuccess: () => { invalidate(); toast.success("Pattern confirmed — no payment was scheduled"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Failed") });
  const ignore = useMutation({ mutationFn: (id: string) => action(id, "ignore"), onSuccess: () => { invalidate(); toast.success("Pattern ignored"); }, onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Failed") });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recurring expenses</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Recurring payments</h1>
      </div>
      <p className="text-xs text-muted-foreground">Detected patterns are informational. Confirming one tracks it; it never schedules a payment.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Detected patterns</CardTitle></CardHeader>
        <CardContent>
          {(patterns.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recurring patterns detected yet.</p> : (
            <div className="divide-y divide-border/70">
              {patterns.data?.items.map((pattern) => (
                <div key={pattern.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{pattern.merchant}</p>
                    <p className="text-[10px] text-muted-foreground">{pattern.frequency.toLowerCase()} · {pattern.confidence} confidence · {pattern.evidenceCount} transactions · last {formatDateTime(pattern.lastSeenAt)}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(pattern.amountMinor, pattern.currency)}</p>
                  {pattern.status === "DETECTED" ? (
                    <>
                      <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate(pattern.id)}>Confirm</Button>
                      <Button size="sm" variant="ghost" disabled={ignore.isPending} onClick={() => ignore.mutate(pattern.id)}>Ignore</Button>
                    </>
                  ) : <span className="rounded-md bg-secondary px-2 py-1 text-[10px]">{pattern.status}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
