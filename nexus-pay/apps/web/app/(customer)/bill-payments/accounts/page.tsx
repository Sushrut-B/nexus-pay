"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import type { BillerView, SavedBillAccountView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function SavedBillersPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["billing", "accounts"], queryFn: () => apiFetch<{ items: SavedBillAccountView[] }>("/api/bill-payments/accounts") });
  const billers = useQuery({ queryKey: ["billing", "billers"], queryFn: () => apiFetch<{ items: BillerView[] }>("/api/bill-payments/billers") });
  const [billerId, setBillerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [identifier, setIdentifier] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const biller = billers.data?.items.find((b) => b.id === billerId);
      const paramName = biller?.parameters.find((p) => p.required)?.name ?? "consumerNumber";
      return apiFetch("/api/bill-payments/accounts", {
        method: "POST", body: JSON.stringify({ billerId, nickname, parameters: { [paramName]: identifier } }),
      });
    },
    onSuccess: () => {
      setNickname(""); setIdentifier("");
      void queryClient.invalidateQueries({ queryKey: ["billing", "accounts"] });
      toast.success("Bill account saved (identifiers masked)");
    },
    onError: () => toast.error("Could not save the account"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bill-payments/accounts/${id}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["billing", "accounts"] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">My billers</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Saved bill accounts</h1>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Add a bill account</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="biller">Biller</Label>
            <select id="biller" value={billerId} onChange={(e) => setBillerId(e.target.value)} className="mt-1.5 h-10 w-56 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">Choose…</option>
              {billers.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><Label htmlFor="nickname">Nickname</Label><Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} className="mt-1.5 w-40" /></div>
          <div><Label htmlFor="identifier">Account identifier</Label><Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="mt-1.5 w-48" /></div>
          <Button disabled={!billerId || nickname.length < 2 || identifier.length < 3 || create.isPending} onClick={() => create.mutate()}>Save account</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Saved accounts</CardTitle></CardHeader>
        <CardContent>
          {(accounts.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No saved bill accounts.</p> : (
            <div className="divide-y divide-border/70">
              {accounts.data?.items.map((account) => (
                <div key={account.id} className="flex items-center justify-between py-3 text-sm">
                  <div><p className="font-medium">{account.nickname}</p><p className="text-xs text-muted-foreground">{account.billerName} · {account.maskedIdentifier}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(account.id)}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
