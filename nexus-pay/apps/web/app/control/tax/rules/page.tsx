"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";

interface RuleSet { id: string; version: string; financialYear: string; status: string }

export default function Page() {
  const rows = useQuery({ queryKey: ["control", "tax", "rules"], queryFn: () => apiFetch<{ items: RuleSet[] }>("/api/control/tax/rules") });
  return (
    <div>
      <ControlPageHeader eyebrow="Tax" title="Rule versions" description="Versioned, sourced tax rule configuration." />
      {rows.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Rule versions</CardTitle></CardHeader>
        <CardContent>
          {(rows.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No records.</p> : (
            <div className="divide-y divide-slate-100">
              {rows.data?.items.map((row) => (
                <div key={row.id} className="flex justify-between py-2 text-xs">
                  <span>{row.version} - FY {row.financialYear}</span>
                  <span className="text-slate-500">{row.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
