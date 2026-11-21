"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { SupportCaseView } from "@nexus/shared-types";
import { StatusPill, SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function SupportCasesPage() {
  const [status, setStatus] = useState("");
  const cases = useQuery({
    queryKey: ["support", "cases", status],
    queryFn: () => apiFetch<{ cases: SupportCaseView[] }>(`/api/support/cases?limit=100${status ? `&status=${status}` : ""}`),
  });
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title="My cases" description="Track status and next steps. Case status is separate from payment status." />
      <SupportNav />
      <SupportNotice>A case marked resolved does not mean a payment, refund or provider operation changed.</SupportNotice>
      <div className="flex flex-wrap items-end gap-3">
        <Input className="w-56" placeholder="Filter by status (e.g. WAITING_FOR_USER)" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} />
        <Button asChild><Link href="/support/new">Report an issue</Link></Button>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Cases</CardTitle></CardHeader><CardContent>
        {(cases.data?.cases ?? []).length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No cases found.</p> : cases.data?.cases.map((c) => (
          <Link key={c.id} href={`/support/cases/${c.id}`} className="block border-b border-border/70 py-3 last:border-0">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-sm font-medium">{c.reference} Â· {c.category.replaceAll("_", " ")}</span>
              <StatusPill status={c.status} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Priority {c.priority} Â· Updated {new Date(c.lastActivityAt).toLocaleString("en-IN")}{c.nextAction ? ` Â· Next: ${c.nextAction}` : ""}</p>
          </Link>
        ))}
      </CardContent></Card>
    </div>
  );
}
