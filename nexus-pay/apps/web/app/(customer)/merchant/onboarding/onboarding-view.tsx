"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { MerchantView } from "@nexus/shared-types";
import { MERCHANT_TYPES } from "@nexus/shared-types";
import { ArrowRight, CheckCircle2, Store } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { StepIndicator } from "@/components/payments/step-indicator";

export function OnboardingView({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const existing = useQuery({
    queryKey: ["merchant", "me"],
    queryFn: () => apiFetch<MerchantView>("/api/merchants"),
    retry: false,
  });

  const [form, setForm] = useState({
    handle: "",
    businessName: "",
    displayName: "",
    businessType: "SMALL_BUSINESS",
    category: "Retail",
    description: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    supportEmail: "",
    refundPolicy: "",
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const create = useMutation({
    mutationFn: () => apiFetch<MerchantView>("/api/merchants", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { setStep(2); setError(null); },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not create merchant."),
  });
  const provision = useMutation({
    mutationFn: () => apiFetch<MerchantView>("/api/merchants/provision", { method: "POST", body: "{}" }),
    onSuccess: () => { setStep(3); setError(null); },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Business wallet provisioning failed."),
  });
  const submit = useMutation({
    mutationFn: () => apiFetch<MerchantView>("/api/merchants/submit", { method: "POST", body: "{}" }),
    onSuccess: () => { setStep(4); setError(null); toast.success("Application submitted for sandbox review"); },
    onError: (failure) => setError(failure instanceof ApiClientError ? failure.message : "Could not submit application."),
  });

  const merchant = existing.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nexus Pay for Business</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Start accepting payments, {displayName.split(" ")[0]}.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sandbox merchant account. Activation is an application-level approval, not regulatory KYC.
        </p>
      </div>

      <StepIndicator steps={["Business", "Profile", "Wallet", "Review"]} current={step} />

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div> : null}

      {merchant && step < 2 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
            <div>
              <p className="text-sm font-semibold">{merchant.businessName}</p>
              <p className="text-xs text-muted-foreground">Status: {merchant.status.replaceAll("_", " ")}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setStep(merchant.status === "DRAFT" ? 2 : 4)}>Continue</Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/merchant")}>Dashboard</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 0 && !merchant ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Business information</CardTitle><CardDescription>Tell us about your business.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="biz-name">Business name</Label><Input id="biz-name" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="biz-display">Display name</Label><Input id="biz-display" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="biz-handle">Merchant handle</Label><Input id="biz-handle" value={form.handle} onChange={(e) => set("handle", e.target.value.toLowerCase())} placeholder="my-shop" className="mt-1.5" /></div>
              <div><Label htmlFor="biz-type">Business type</Label><select id="biz-type" value={form.businessType} onChange={(e) => set("businessType", e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">{MERCHANT_TYPES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
              <div><Label htmlFor="biz-category">Category</Label><Input id="biz-category" value={form.category} onChange={(e) => set("category", e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="biz-email">Business email</Label><Input id="biz-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="biz-phone">Business phone</Label><Input id="biz-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="mt-1.5" /></div>
              <div><Label htmlFor="biz-website">Website (optional)</Label><Input id="biz-website" value={form.website} onChange={(e) => set("website", e.target.value)} className="mt-1.5" /></div>
            </div>
            <div><Label htmlFor="biz-desc">Description</Label><Input id="biz-desc" value={form.description} onChange={(e) => set("description", e.target.value)} className="mt-1.5" /></div>
            <Button disabled={!form.handle || !form.businessName || !form.email || create.isPending} onClick={() => create.mutate()}>
              Save and continue <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Business wallet</CardTitle><CardDescription>Provision a verified Raftline account for this business. Safe to retry.</CardDescription></CardHeader>
          <CardContent>
            <Button onClick={() => provision.mutate()} disabled={provision.isPending}>
              <Store className="h-4 w-4" /> {provision.isPending ? "Provisioning…" : "Provision business wallet"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Review and submit</CardTitle><CardDescription>Sandbox review is performed by a Nexus Control administrator.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
              <p className="font-semibold">{form.businessName || merchant?.businessName}</p>
              <p className="text-xs text-muted-foreground">@{form.handle || merchant?.handle} · {form.businessType.replaceAll("_", " ")}</p>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Approval is application-level only. It does not permit real-world payment acceptance.
            </div>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>Submit for review</Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-3 text-sm font-semibold">Application submitted</p>
            <p className="mt-1 text-xs text-muted-foreground">An administrator will review it in Nexus Control.</p>
            <Button className="mt-4" onClick={() => router.push("/merchant")}>Go to dashboard</Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

