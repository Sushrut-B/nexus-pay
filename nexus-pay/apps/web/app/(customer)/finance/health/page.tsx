"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { HealthScoreView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function HealthPage() {
  const health = useQuery({ queryKey: ["finance", "health"], queryFn: () => apiFetch<HealthScoreView>("/api/finance/health-score") });
  const data = health.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Financial wellbeing</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Financial health</h1>
      </div>
      {data ? (
        <>
          <Alert><AlertDescription>{data.notice}</AlertDescription></Alert>
          {!data.available ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{data.reason}</CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Overall score</CardTitle></CardHeader>
                <CardContent><p className="font-display text-5xl font-semibold text-navy">{data.overallScore}<span className="text-xl text-muted-foreground">/100</span></p></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Dimensions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.dimensions.map((dimension) => (
                    <div key={dimension.key}>
                      <div className="flex justify-between text-xs"><span>{dimension.key.replaceAll("_", " ")}</span><span>{dimension.score}/100 · {dimension.weight}%</span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${dimension.score}%` }} /></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{dimension.explanation}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">How this is calculated</CardTitle></CardHeader>
                <CardContent><p className="text-xs text-muted-foreground">{data.formula}</p></CardContent>
              </Card>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
