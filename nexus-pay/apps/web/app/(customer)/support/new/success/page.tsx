"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { SupportHeader, SupportNav, SupportNotice } from "@/components/support/support-ui";

export default function SupportCaseSubmittedPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading confirmation...</p>}><ConfirmationContent /></Suspense>;
}

function ConfirmationContent() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  return (
    <div className="space-y-6">
      <SupportHeader eyebrow="Support Centre" title="Case submitted" description="Your case reference is below. Keep it for your records." />
      <SupportNav />
      <SupportNotice>A support case does not change a payment, refund or provider status. No resolution time is promised.</SupportNotice>
      <Card><CardHeader><CardTitle className="text-base">Confirmation</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm">Your case has been recorded. You will be notified of verified updates.</p>
        <p className="font-mono text-sm">Case ID: {id || "â€”"}</p>
        <div className="flex gap-2"><Button asChild><Link href={`/support/cases/${id}`}>View case</Link></Button><Button asChild variant="outline"><Link href="/support/cases">All cases</Link></Button></div>
      </CardContent></Card>
    </div>
  );
}
