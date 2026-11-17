"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { PaymentLinkView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function PaymentLinksPage() {
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: ["merchant", "links"], queryFn: () => apiFetch<{ items: PaymentLinkView[] }>("/api/merchant/payment-links") });
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PaymentLinkView | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const minor = Math.round(Number(amount) * 100);
      if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Enter a valid amount.");
      return apiFetch<PaymentLinkView>("/api/merchant/payment-links", { method: "POST", body: JSON.stringify({ title, amountMinor: minor }) });
    },
    onSuccess: (link) => { setCreated(link); setTitle(""); setAmount(""); setError(null); void queryClient.invalidateQueries({ queryKey: ["merchant", "links"] }); toast.success("Payment link created"); },
    onError: (failure) => setError(failure instanceof ApiClientError || failure instanceof Error ? failure.message : "Could not create link."),
  });
  const disable = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/merchant/payment-links/${encodeURIComponent(id)}`, { method: "POST", body: "{}" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["merchant", "links"] }),
  });

  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Get paid</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Payment links</h1></div>
      <Card>
        <CardHeader><CardTitle className="text-base">Create a link</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="link-title">Title</Label><Input id="link-title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5" /></div>
            <div><Label htmlFor="link-amount">Amount (INR)</Label><Input id="link-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1.5" /></div>
          </div>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Create link</Button>
          {created ? <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs break-all">Share: <span className="font-mono text-primary">{created.url}</span></div> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Your links</CardTitle></CardHeader>
        <CardContent>
          {(links.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No payment links yet.</p> : (
            <div className="divide-y divide-border/70">
              {links.data?.items.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{link.title}</p><p className="text-[10px] text-muted-foreground">{link.paymentCount} payments · {link.status}</p></div>
                  <p className="text-sm font-semibold">{formatMoney(link.amountMinor, link.currency)}</p>
                  <Button size="sm" variant="ghost" asChild><Link href={`/merchant/payment-links/${encodeURIComponent(link.id)}/qr`}>QR</Link></Button>
                  <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${link.url}`)}>Copy</Button>
                  {link.status === "ACTIVE" ? <Button size="sm" variant="ghost" onClick={() => disable.mutate(link.id)}>Disable</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


