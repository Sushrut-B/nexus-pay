"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { ExternalAccountView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export function AccountDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["accounts", "detail", id], queryFn: () => apiFetch<ExternalAccountView>(`/api/accounts/${encodeURIComponent(id)}`) });
  const sync = useQuery({
    queryKey: ["accounts", "sync-status", id],
    queryFn: () => apiFetch<{ jobs: Array<{ id: string; kind: string; status: string; attempts: number; error: string | null }> }>(`/api/accounts/${encodeURIComponent(id)}/sync-status`),
  });
  const refresh = useMutation({
    mutationFn: () => apiFetch(`/api/accounts/${encodeURIComponent(id)}/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Sync queued"); },
    onError: () => toast.error("Could not queue sync"),
  });
  const disconnect = useMutation({
    mutationFn: () => apiFetch(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Account disconnected"); },
    onError: () => toast.error("Could not disconnect"),
  });
  const data = account.data;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Account details</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.institutionName ?? "Account"}</h1>
      </div>
      {data ? (
        <>
          <Card>
            <CardContent className="space-y-2 py-6 text-sm">
              <p>Type: {data.accountType.replaceAll("_", " ")}</p>
              <p>Masked identifier: {data.maskedIdentifier}</p>
              <p>Reported balance: {data.balanceMinor === null ? "Unavailable" : formatMoney(data.balanceMinor, data.currency)}</p>
              <p>Provider: {data.providerName}</p>
              <p>Status: {data.status}</p>
              <p>Last sync: {data.lastSyncAt ? formatDateTime(data.lastSyncAt) : "—"}</p>
              {data.isSandbox ? <p className="text-xs text-amber-700">Sandbox test data — no real institution connected.</p> : null}
              <div className="flex gap-2 pt-3">
                <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>Sync now</Button>
                <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Recent synchronisation</CardTitle></CardHeader>
            <CardContent>
              {(sync.data?.jobs ?? []).length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No sync jobs yet.</p> : (
                <div className="divide-y divide-border/70">
                  {sync.data?.jobs.map((job) => (
                    <div key={job.id} className="flex justify-between py-2 text-xs"><span>{job.kind}</span><span>{job.status} · {job.attempts} tries</span></div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
