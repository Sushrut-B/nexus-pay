"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { ConversionView } from "@nexus/shared-types";
import { formatByCurrency } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

export default function ConverterPage() {
  const [form, setForm] = useState({ from: "USD", to: "INR", amountMinor: "10000" });
  const mutation = useMutation({
    mutationFn: () => apiFetch<ConversionView>("/api/global-finance/convert", {
      method: "POST", body: JSON.stringify({ ...form, amountMinor: Number(form.amountMinor) }),
    }),
  });
  const result = mutation.data;
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Currency converter" description="An informational conversion using a source-attributed reference rate. Not an executable quote." />
      <GlobalNav />
      <GlobalNotice>{result?.notice ?? "Fees and taxes are not included unless a verified provider quote states otherwise. No conversion is executed."}</GlobalNotice>
      <Card>
        <CardHeader><CardTitle className="text-base">Convert an amount</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="From" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value.toUpperCase() })} />
          <Input placeholder="To" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value.toUpperCase() })} />
          <Input placeholder="Amount (minor units)" value={form.amountMinor} onChange={(e) => setForm({ ...form, amountMinor: e.target.value })} />
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Convertingâ€¦" : "Convert"}</Button>
        </CardContent>
      </Card>
      {mutation.isError ? <p className="text-sm text-destructive">{mutation.error instanceof Error ? mutation.error.message : "Conversion unavailable"}</p> : null}
      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Original" value={formatByCurrency(result.originalMinor, result.sourceCurrency)} />
            <Metric label="Estimated conversion" value={formatByCurrency(result.convertedMinor, result.targetCurrency)} />
            <Metric label="Rate" value={result.rate} />
            <Metric label="Classification" value={result.classification} />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 text-xs text-muted-foreground">
            <p>Source: {result.providerCode} Â· Rate as of {new Date(result.rateAsOf).toLocaleString("en-IN")}</p>
            <p>{result.feeNotice}</p>
            <p>Rounding: {result.rounding}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
