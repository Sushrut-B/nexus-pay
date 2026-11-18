"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent } from "@nexus/ui";
import type { ApplicationView } from "@nexus/shared-types";
import { formatDateTime } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";

export default function ApplicationsPage() {
  const applications = useQuery({ queryKey: ["credit", "applications"], queryFn: () => apiFetch<{ items: ApplicationView[] }>("/api/credit/applications") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Applications</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Loan applications</h1>
      </div>
      {(applications.data?.items ?? []).length === 0 ? <Card><CardContent className="py-12 text-center text-xs text-muted-foreground">No applications yet.</CardContent></Card> : (
        <div className="divide-y divide-border/70 rounded-2xl border border-border bg-card">
          {applications.data?.items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.providerName}</p><p className="text-[10px] text-muted-foreground">{formatDateTime(item.createdAt)} · {item.status}</p></div>
              {item.isSandbox ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800">SANDBOX</span> : null}
              <Button size="sm" variant="outline" asChild><Link href={`/credit/applications/${encodeURIComponent(item.id)}`}>Track</Link></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

