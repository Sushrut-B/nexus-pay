"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import type { UnifiedTransactionView } from "@nexus/shared-types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function UnifiedTransactionsPage() {
  const [scope, setScope] = useState("ALL");
  const [search, setSearch] = useState("");
  const transactions = useQuery({
    queryKey: ["accounts", "transactions", scope],
    queryFn: () => apiFetch<{ items: UnifiedTransactionView[]; total: number }>(`/api/accounts/transactions?scope=${scope}&pageSize=50`),
  });
  const items = (transactions.data?.items ?? []).filter((item) => !search || `${item.description} ${item.institution} ${item.merchant ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Unified history</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Transactions</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transactions" aria-label="Search" className="h-9 w-64" />
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope" className="h-9 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="ALL">All accounts</option>
          <option value="WALLET">Nexus Pay wallet</option>
          <option value="ACCOUNT">Connected accounts</option>
        </select>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{transactions.data?.total ?? 0} transactions</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No transactions in this scope.</p> : (
            <div className="divide-y divide-border/70">
              {items.map((item) => (
                <div key={`${item.source}-${item.id}`} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.description}</p>
                    <p className="text-[10px] text-muted-foreground">{item.institution} · {item.maskedAccount} · {formatDateTime(item.transactionAt)} · {item.status}</p>
                  </div>
                  <p className="text-sm font-semibold">{item.direction === "IN" ? "+" : "−"}{formatMoney(item.amountMinor, item.currency)}</p>
                  {item.isSandbox ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800">SANDBOX</span> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
