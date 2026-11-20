"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { GlobalInsightView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function GlobalInsightsPage() {
  const query = useQuery({ queryKey: ["global", "insights"], queryFn: () => apiFetch<{ insights: GlobalInsightView[] }>("/api/global-finance/insights") });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Global financial insights" description="Explainable insights that name their data, currency, rate, date and methodology." />
      <GlobalNav />
      <GlobalNotice>No speculative currency predictions are presented as fact. Insights do not constitute financial advice.</GlobalNotice>
      {(query.data?.insights ?? []).length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No insights available.</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data?.insights.map((insight) => (
            <Card key={insight.id}>
              <CardHeader><CardTitle className="text-base">{insight.title}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{insight.detail}</p>
                <p className="text-xs text-muted-foreground">Currency: {insight.currency} Â· Source: {insight.rateSource ?? "n/a"} Â· Calculated: {new Date(insight.calculationDate).toLocaleString("en-IN")}</p>
                <p className="text-xs text-muted-foreground">Method: {insight.methodology}</p>
                <p className="text-xs text-muted-foreground">Data: {insight.dataUsed.join(", ")}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
