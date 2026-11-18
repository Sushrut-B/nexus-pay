"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ExternalAccountView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { toast } from "sonner";

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => apiFetch<{ items: ExternalAccountView[] }>("/api/accounts") });
  const sync = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts/${encodeURIComponent(id)}/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Synchronisation queued"); },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : "Sync request failed"),
  });
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Unified financial hub</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Your accounts</h1>
        </div>
        <Button asChild><Link href="/accounts/connect">Connect account</Link></Button>
      </div>
      <Alert><AlertDescription>External accounts are provider-reported and read-only. Raftline remains authoritative for your Nexus Pay wallet balance.</AlertDescription></Alert>
      {(accounts.data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No accounts found.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.data?.items.map((account) => (
            <Card key={account.id}>
              <CardHeader>
                <CardTitle className="text-base">{account.institutionName}</CardTitle>
                <p className="text-xs text-muted-foreground">{account.accountType.replaceAll("_", " ")} · {account.maskedIdentifier}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-display text-2xl font-semibold text-navy">
                  {account.balanceMinor === null ? "Unavailable" : formatMoney(account.balanceMinor, account.currency)}
                </p>
                {account.liability ? <p className="text-xs text-amber-700">Liability — never counted as available cash</p> : null}
                {account.isSandbox ? <p className="text-xs text-amber-700">Sandbox test data — no real institution connected</p> : null}
                <p className="text-[10px] text-muted-foreground">
                  {account.providerName} · {account.status} · {account.lastSyncAt ? `Synced ${formatDateTime(account.lastSyncAt)}` : "Not synced"}
                </p>
                {!account.isWallet ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(account.id)}>Sync</Button>
                    <Button size="sm" variant="ghost" asChild><Link href={`/accounts/${encodeURIComponent(account.id)}`}>Details</Link></Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
