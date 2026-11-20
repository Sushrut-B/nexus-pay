"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { TaxScenarioView, TaxDeadlineView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function TaxPlanningPage() {
  const queryClient = useQueryClient();
  const scenarios = useQuery({ queryKey: ["tax", "scenarios"], queryFn: () => apiFetch<{ items: TaxScenarioView[] }>("/api/tax/scenarios") });
  const deadlines = useQuery({ queryKey: ["tax", "deadlines"], queryFn: () => apiFetch<{ items: TaxDeadlineView[] }>("/api/tax/deadlines") });
  const [name, setName] = useState("");
  const [addition, setAddition] = useState("50000");
  const create = useMutation({
    mutationFn: () => apiFetch("/api/tax/scenarios", {
      method: "POST", body: JSON.stringify({ financialYear: "2025-26", name, inputs: { deductionsMinor: Number(addition) * 100 } }),
    }),
    onSuccess: () => { setName(""); void queryClient.invalidateQueries({ queryKey: ["tax", "scenarios"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Planning</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Scenarios & tax calendar</h1>
      </div>
      <p className="text-xs text-muted-foreground">Scenarios are separate from your actual financial records and never create investments or payments.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">New scenario</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-48" /></div>
          <div><Label htmlFor="addition">Extra deduction (₹)</Label><Input id="addition" type="number" value={addition} onChange={(e) => setAddition(e.target.value)} className="mt-1.5 w-44" /></div>
          <Button disabled={name.length < 2 || create.isPending} onClick={() => create.mutate()}>Create scenario</Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Saved scenarios</CardTitle></CardHeader>
          <CardContent>
            {(scenarios.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No scenarios yet.</p> : (
              <div className="divide-y divide-border/70">
                {scenarios.data?.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-3 text-sm"><span>{item.name}</span><span className="text-xs text-muted-foreground">Old {item.result.oldNetTaxMinor ?? 0} / New {item.result.newNetTaxMinor ?? 0}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming deadlines</CardTitle></CardHeader>
          <CardContent>
            {(deadlines.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No deadlines configured.</p> : (
              <div className="divide-y divide-border/70">
                {deadlines.data?.items.slice(0, 8).map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-xs"><span>{item.title}</span><span className="text-muted-foreground">{new Date(item.dueDate).toLocaleDateString("en-IN")}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
