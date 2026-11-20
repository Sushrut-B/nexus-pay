"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { MultiCurrencyAccountView } from "@nexus/shared-types";
import { formatMoney } from "@/lib/format";
import { Empty, GlobalHeader, GlobalNav, GlobalNotice, Metric } from "@/components/global/global-ui";

export default function CurrencyAccountsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["global", "accounts"], queryFn: () => apiFetch<{ accounts: MultiCurrencyAccountView[] }>("/api/global-finance/accounts") });
  const [form, setForm] = useState({ name: "", providerCode: "USER", accountType: "CASH", currency: "USD", originalBalanceMinor: "0" });
  const mutation = useMutation({
    mutationFn: () => apiFetch("/api/global-finance/accounts", {
      method: "POST",
      body: JSON.stringify({ ...form, originalBalanceMinor: Number(form.originalBalanceMinor), classification: "USER_REPORTED" }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["global", "accounts"] }); setForm({ name: "", providerCode: "USER", accountType: "CASH", currency: "USD", originalBalanceMinor: "0" }); },
  });
  const accounts = query.data?.accounts ?? [];
  return (
    <div className="space-y-6">
      <GlobalHeader eyebrow="Global Finance" title="Currency accounts" description="Track balances in their original currency. Never mutate an original amount; converted values are estimates only." />
      <GlobalNav />
      <GlobalNotice>User-entered balances are never presented as independently verified. No foreign-currency wallet balances are created.</GlobalNotice>
      <div className="grid gap-4 sm:grid-cols-4">
        <Metric label="Tracked accounts" value={String(accounts.length)} />
        <Metric label="Currencies" value={String(new Set(accounts.map((a) => a.currency)).size)} />
        <Metric label="Wallet accounts" value={String(accounts.filter((a) => a.isWallet).length)} />
        <Metric label="Stale/unverified" value={String(accounts.filter((a) => a.classification === "STALE_DATA" || a.verificationStatus === "UNVERIFIED").length)} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Add a user-reported account</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Provider" value={form.providerCode} onChange={(e) => setForm({ ...form, providerCode: e.target.value })} />
          <Input placeholder="Type" value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} />
          <Input placeholder="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          <Input placeholder="Minor units" value={form.originalBalanceMinor} onChange={(e) => setForm({ ...form, originalBalanceMinor: e.target.value })} />
          <Button className="sm:col-span-5" disabled={mutation.isPending || form.name.length < 2} onClick={() => mutation.mutate()}>{mutation.isPending ? "Savingâ€¦" : "Add account"}</Button>
        </CardContent>
      </Card>
      <div className="rounded-2xl border border-border bg-card p-5">
        {accounts.length === 0 ? <Empty>No accounts tracked.</Empty> : (
          <div className="divide-y divide-border/70">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">{account.name}</p>
                  <p className="text-xs text-muted-foreground">{account.providerCode} Â· {account.accountType} Â· {account.classification}</p>
                </div>
                <div className="text-right">
                  <p>{formatMoney(account.originalBalanceMinor, account.currency)}</p>
                  <p className="text-xs text-muted-foreground">{account.displayBalanceMinor == null ? "No converted value" : `â‰ˆ ${formatMoney(account.displayBalanceMinor, account.displayCurrency)}`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
