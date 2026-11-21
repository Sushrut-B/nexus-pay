"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { SupportCategory, SupportCaseView, SupportLinkType, SupportCategoryOption } from "@nexus/shared-types";
import { SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function NewSupportCasePage() {
  const router = useRouter();
  const categories = useQuery({ queryKey: ["support", "categories"], queryFn: () => apiFetch<{ categories: SupportCategoryOption[] }>("/api/support/categories") });
  const [form, setForm] = useState({ category: "PAYMENT_STATUS_UNCLEAR" as SupportCategory, linkedType: "GENERAL" as SupportLinkType, linkedReference: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch<SupportCaseView>("/api/support/cases", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        ...(form.linkedReference ? { linkedReference: form.linkedReference } : {}),
        idempotencyKey: `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    }),
    onSuccess: (c) => router.push(`/support/new/success?id=${encodeURIComponent(c.id)}`),
    onError: (e) => setError(e instanceof ApiClientError ? e.message : "Could not submit the case."),
  });
  const selected = useMemo(() => categories.data?.categories.find((c) => c.category === form.category), [categories.data, form.category]);
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title="Report an issue" description="Follow the steps below. Never include passwords, PINs, OTPs or card details." />
      <SupportNav />
      <SupportNotice>Your original description is stored exactly as written. A payment reference is verified against your account before it is attached.</SupportNotice>
      <Card><CardHeader><CardTitle className="text-base">1. Choose an issue category</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">
        {categories.data?.categories.map((option) => (
          <button key={option.category} type="button" onClick={() => setForm({ ...form, category: option.category, linkedType: option.linkType })}
            className={`rounded-xl border p-3 text-left text-sm ${form.category === option.category ? "border-primary bg-primary/5" : "border-border"}`}>
            <span className="font-medium">{option.label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">2. Linked record and description</CardTitle></CardHeader><CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Linked type" value={form.linkedType} onChange={(e) => setForm({ ...form, linkedType: e.target.value.toUpperCase() as SupportLinkType })} />
          <Input placeholder="Record reference (optional)" value={form.linkedReference} onChange={(e) => setForm({ ...form, linkedReference: e.target.value })} />
        </div>
        <textarea className="min-h-32 w-full rounded-xl border border-border bg-card p-3 text-sm" placeholder="Describe the issue. Do not include passwords, PINs or OTPs." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <p className="text-xs text-muted-foreground">Selected: {selected?.label ?? form.category} Â· Evidence can be attached after submission.</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button disabled={mutation.isPending || form.description.trim().length < 10} onClick={() => mutation.mutate()}>{mutation.isPending ? "Submittingâ€¦" : "Submit case"}</Button>
      </CardContent></Card>
    </div>
  );
}
