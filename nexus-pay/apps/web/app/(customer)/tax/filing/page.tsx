"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { TaxFilingReadinessView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function TaxFilingPage() {
  const readiness = useQuery({ queryKey: ["tax", "readiness"], queryFn: () => apiFetch<TaxFilingReadinessView>("/api/tax/filing-readiness") });
  const [question, setQuestion] = useState("What is the difference between financial year and assessment year?");
  const [answer, setAnswer] = useState<{ answer: string; sources: string[]; ruleSetVersion: string } | null>(null);
  const ask = useMutation({
    mutationFn: () => apiFetch<{ answer: string; sources: string[]; ruleSetVersion: string }>("/api/tax/assistant", {
      method: "POST", body: JSON.stringify({ question, financialYear: "2025-26" }),
    }),
    onSuccess: setAnswer,
  });
  const data = readiness.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Filing readiness</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Prepare & understand</h1>
      </div>
      <Alert><AlertDescription>{data?.notice ?? "This is preparation only. No return has been prepared or submitted, and Nexus Pay is not a filing intermediary."}</AlertDescription></Alert>
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Checklist · {(data.completionBps / 100).toFixed(0)}% complete</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.items.map((item) => (
                <div key={item.code} className="flex justify-between rounded-lg border border-border p-3 text-sm">
                  <span>{item.label}</span>
                  <span className={item.status === "COMPLETE" ? "text-emerald-700" : "text-amber-700"}>{item.status}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle className="text-base">Tax Assistant</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
            <Button disabled={ask.isPending} onClick={() => ask.mutate()}>Ask</Button>
          </div>
          {answer ? (
            <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
              <p>{answer.answer}</p>
              <p className="mt-2 text-xs text-muted-foreground">Sources: {answer.sources.join(", ") || "General"} · Rule set {answer.ruleSetVersion}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
