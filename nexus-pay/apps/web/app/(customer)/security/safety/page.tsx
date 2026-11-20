"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SafetyGuideView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";

export default function SafetyCentrePage() {
  const guides = useQuery({ queryKey: ["security", "guides"], queryFn: () => apiFetch<{ items: SafetyGuideView[] }>("/api/security/safety-guides") });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Safety centre</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Recognise and avoid scams</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {guides.data?.items.map((guide) => (
          <Card key={guide.id}>
            <CardHeader><CardTitle className="text-base">{guide.title}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{guide.summary}</p>
              <ul className="list-inside list-disc space-y-1 text-xs">
                {guide.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
