"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { BudgetRecommendationView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function BudgetRecommendationsPage() {
  const queryClient = useQueryClient();
  const recommendations = useQuery({ queryKey: ["finance", "budget-recommendations"], queryFn: () => apiFetch<{ items: BudgetRecommendationView[] }>("/api/finance/budget-recommendations") });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) => apiFetch(`/api/finance/budget-recommendations/${encodeURIComponent(id)}/decide`, { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["finance", "budget-recommendations"] }); toast.success("Recommendation updated — existing budgets unchanged"); },
    onError: () => toast.error("Could not update recommendation"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Smart budgets</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Budget recommendations</h1>
      </div>
      <p className="text-xs text-muted-foreground">Suggestions are based on recorded spending. Nothing changes until you approve a recommendation.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">Suggestions</CardTitle></CardHeader>
        <CardContent>
          {(recommendations.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No recommendations yet.</p> : (
            <div className="divide-y divide-border/70">
              {recommendations.data?.items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.category.replaceAll("_", " ")}</p>
                    <p className="text-[10px] text-muted-foreground">Historical average {formatMoney(item.historicalAverageMinor, "INR")} · {item.reason}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatMoney(item.suggestedMinor, "INR")}</p>
                  {item.status === "SUGGESTED" ? (
                    <>
                      <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "APPROVE" })}>Approve</Button>
                      <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: item.id, decision: "REJECT" })}>Reject</Button>
                    </>
                  ) : <span className="text-xs">{item.status}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
