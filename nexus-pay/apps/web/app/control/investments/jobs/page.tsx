"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { ControlPageHeader, LoadingState } from "@/components/control/ui";
import { toast } from "sonner";

interface Job { id: string; kind: string; status: string; attempts: number; error: string | null; provider: { code: string } }

export default function ControlInvestmentJobsPage() {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["control", "investments", "jobs"], queryFn: () => apiFetch<{ items: Job[] }>("/api/control/investments/jobs") });
  const retry = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/control/investments/jobs/${id}/retry`, { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["control", "investments", "jobs"] }); toast.success("Read-only job requeued"); },
    onError: () => toast.error("Only failed read-only jobs can be retried"),
  });
  return (
    <div>
      <ControlPageHeader eyebrow="Investments" title="Synchronization jobs" description="Read-only job retry is limited to failed jobs; consent is revalidated before every sync." />
      {jobs.isLoading ? <LoadingState /> : null}
      <Card>
        <CardHeader><CardTitle className="text-sm">Jobs</CardTitle></CardHeader>
        <CardContent>
          {(jobs.data?.items ?? []).length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No sync jobs.</p> : (
            <div className="divide-y divide-slate-100">
              {jobs.data?.items.map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 text-xs">
                  <span>{job.provider.code} · {job.kind} · {job.status} · attempts {job.attempts}</span>
                  {(job.status === "FAILED" || job.status === "DEAD_LETTER") ? <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>Retry</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
