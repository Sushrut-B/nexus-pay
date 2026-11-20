"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@nexus/ui";
import type { SessionView } from "@nexus/shared-types";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

export default function SecuritySessionsPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["security", "sessions"], queryFn: () => apiFetch<{ items: SessionView[] }>("/api/security/sessions") });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/security/sessions/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "sessions"] }); toast.success("Session revoked"); },
    onError: () => toast.error("Could not revoke the session"),
  });
  const revokeOthers = useMutation({
    mutationFn: () => apiFetch("/api/security/sessions/revoke-others", { method: "POST", body: "{}" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "sessions"] }); toast.success("Other sessions revoked"); },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Sessions</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">Active sessions</h1>
        </div>
        <Button size="sm" variant="outline" disabled={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out other devices</Button>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Devices currently signed in</CardTitle></CardHeader>
        <CardContent>
          {(sessions.data?.items ?? []).length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No active sessions.</p> : (
            <div className="divide-y divide-border/70">
              {sessions.data?.items.map((session) => (
                <div key={session.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">{session.current ? "This device" : "Another device"} · {session.classification}</p>
                    <p className="text-xs text-muted-foreground">Session {session.sessionId.slice(-8)} · risk {session.score}</p>
                  </div>
                  {!session.current ? <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(session.sessionId)}>Revoke</Button> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
