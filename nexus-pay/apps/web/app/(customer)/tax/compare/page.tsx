"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { TaxRegimeComparisonView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function TaxComparePage() {
  const [salary, setSalary] = useState("1500000");
  const [other, setOther] = useState("100000");
  const [house, setHouse] = useState("0");
  const [deductions, setDeductions] = useState("150000");
  const [special, setSpecial] = useState("0");
  const [credits, setCredits] = useState("0");
  const [result, setResult] = useState<TaxRegimeComparisonView | null>(null);
  const compare = useMutation({
    mutationFn: () => apiFetch<TaxRegimeComparisonView>("/api/tax/compare-regimes", {
      method: "POST",
      body: JSON.stringify({
        financialYear: "2025-26",
        salaryMinor: Number(salary) * 100,
        otherIncomeMinor: Number(other) * 100,
        housePropertyMinor: Number(house) * 100,
        deductionsMinor: Number(deductions) * 100,
        specialRateIncomeMinor: Number(special) * 100,
        creditsMinor: Number(credits) * 100,
      }),
    }),
    onSuccess: setResult,
  });
  const fields = [
    { label: "Salary (₹)", value: salary, set: setSalary },
    { label: "Other income (₹)", value: other, set: setOther },
    { label: "House property (₹)", value: house, set: setHouse },
    { label: "Eligible deductions (₹)", value: deductions, set: setDeductions },
    { label: "Special-rate income (₹)", value: special, set: setSpecial },
    { label: "Verified credits (₹)", value: credits, set: setCredits },
  ];
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Regime comparison</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Old vs new tax regime</h1>
      </div>
      <Alert><AlertDescription>Estimates use versioned rules and your inputs. Deductions apply mainly under the old regime; no regime is automatically recommended. Not professional tax advice.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Adjust inputs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map((field) => (
              <div key={field.label}>
                <Label>{field.label}</Label>
                <Input type="number" value={field.value} onChange={(e) => field.set(e.target.value)} className="mt-1.5" />
              </div>
            ))}
          </div>
          <Button disabled={compare.isPending} onClick={() => compare.mutate()}>Compare regimes</Button>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Estimated outcome · {result.ruleSetVersion}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="font-medium">Old regime</p>
                <p>Taxable: {formatMoney(result.old.taxableMinor, "INR")}</p>
                <p>Estimated tax: {formatMoney(result.old.netTaxMinor, "INR")}</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="font-medium">New regime</p>
                <p>Taxable: {formatMoney(result.new.taxableMinor, "INR")}</p>
                <p>Estimated tax: {formatMoney(result.new.netTaxMinor, "INR")}</p>
              </div>
            </div>
            <p>Estimated difference (old − new): {formatMoney(result.differenceMinor, "INR")}</p>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {result.materialDrivers.map((driver) => <li key={driver}>{driver}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">{result.notice}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
