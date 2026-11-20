"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { BeneficiaryView } from "@nexus/shared-types";
import { GlobalHeader, GlobalNav, GlobalNotice } from "@/components/global/global-ui";

export default function BeneficiariesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["global", "beneficiaries"], queryFn: () => apiFetch<{ beneficiaries: BeneficiaryView[] }>("/api/international-payments/beneficiaries") });
  const [form, setForm] = useState({ label: "", country: "US", currency: "USD", bankName: "", accountIdentifier: "", paymentMethod: "BANK_TRANSFER" });
  const mutation = useMutation({
    mutationFn: () => apiFetch("/api/international-payments/beneficiaries", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "beneficiaries"] }); setForm({ label: "", country: "US", currency: "USD", bankName: "", accountIdentifier: "", paymentMethod: "BANK_TRANSFER" }); },
  });
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="International beneficiaries" description="Beneficiary details are encrypted at rest and displayed masked. Verification requires an authorized provider." />
      <GlobalNav />
      <GlobalNotice>No beneficiary is verified by Nexus Pay. No full account identifier is shown after entry.</GlobalNotice>
      <Card><CardHeader><CardTitle className="text-base">Add a beneficiary</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3">
        <Input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <Input placeholder="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
        <Input placeholder="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        <Input placeholder="Bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
        <Input placeholder="Account identifier" value={form.accountIdentifier} onChange={(e) => setForm({ ...form, accountIdentifier: e.target.value })} />
        <Input placeholder="Payment method" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} />
        <Button className="sm:col-span-3" disabled={mutation.isPending || form.label.length < 2 || form.accountIdentifier.length < 4} onClick={() => mutation.mutate()}>Save beneficiary</Button>
      </CardContent></Card>
      <div className="rounded-2xl border border-border bg-card p-5">
        {(query.data?.beneficiaries ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No beneficiaries saved.</p> : query.data?.beneficiaries.map((b) => (
          <div key={b.id} className="flex justify-between border-b border-border/70 py-3 text-sm">
            <div><p className="font-medium">{b.label}</p><p className="text-xs text-muted-foreground">{b.country} Â· {b.currency} Â· {b.bankName ?? "â€”"} Â· {b.accountMasked}</p></div>
            <span className="text-xs text-muted-foreground">{b.verificationStatus}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
