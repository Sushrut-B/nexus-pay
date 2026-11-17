"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { useQuery } from "@tanstack/react-query";
import type { MerchantView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function SettingsPage() {
  const merchant = useQuery({ queryKey: ["merchant", "me"], queryFn: () => apiFetch<MerchantView>("/api/merchants") });
  const data = merchant.data;
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Settings</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Business settings</h1></div>
      {data ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Business profile</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {data.businessName}</p>
            <p><span className="text-muted-foreground">Handle:</span> @{data.handle}</p>
            <p><span className="text-muted-foreground">Type:</span> {data.businessType.replaceAll("_", " ")}</p>
            <p><span className="text-muted-foreground">Status:</span> {data.status.replaceAll("_", " ")}</p>
            <p><span className="text-muted-foreground">Email:</span> {data.email}</p>
            <p><span className="text-muted-foreground">Phone:</span> {data.phone}</p>
            <p className="text-xs text-muted-foreground">Sandbox approval is application-level only. No real-world payment acceptance is implied.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

