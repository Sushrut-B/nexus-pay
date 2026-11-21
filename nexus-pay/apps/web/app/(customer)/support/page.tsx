"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { SupportCaseView } from "@nexus/shared-types";
import { Metric, StatusPill, SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function SupportHomePage() {
  const cases = useQuery({ queryKey: ["support", "cases"], queryFn: () => apiFetch<{ cases: SupportCaseView[] }>("/api/support/cases?limit=100") });
  const all = cases.data?.cases ?? [];
  const open = all.filter((c) => !["RESOLVED", "CLOSED"].includes(c.status));
  const awaitingUser = all.filter((c) => c.status === "WAITING_FOR_USER");
  const resolved = all.filter((c) => ["RESOLVED", "CLOSED"].includes(c.status));
  const unread = all.reduce((sum, c) => sum + c.unreadCount, 0);
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title="How can we help?" description="Report an issue, track your cases and find guidance. A support case never changes a payment or provider status." />
      <SupportNav />
      <SupportNotice>Support outcomes are case-management decisions only. Refunds, reversals and payment corrections require authoritative confirmation and are never claimed by a support case.</SupportNotice>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Open cases" value={String(open.length)} />
        <Metric label="Awaiting your response" value={String(awaitingUser.length)} />
        <Metric label="Recently resolved" value={String(resolved.length)} />
        <Metric label="Unread messages" value={String(unread)} />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Frequently used actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild><Link href="/support/new">Report an issue</Link></Button>
          <Button asChild variant="outline"><Link href="/support/cases">View my cases</Link></Button>
          <Button asChild variant="outline"><Link href="/support/help">Browse help articles</Link></Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent cases</CardTitle></CardHeader>
        <CardContent>
          {all.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No support cases yet.</p> : all.slice(0, 6).map((c) => (
            <Link key={c.id} href={`/support/cases/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 py-2 text-sm last:border-0">
              <span>{c.reference} Â· {c.category.replaceAll("_", " ").toLowerCase()}</span>
              <span className="flex items-center gap-2"><StatusPill status={c.status} />{c.unreadCount > 0 ? <span className="text-xs font-semibold text-primary">{c.unreadCount} new</span> : null}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
