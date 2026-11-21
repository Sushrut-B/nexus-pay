"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { passwordSchema } from "@nexus/validation";
import { SecurityNav } from "@/components/security/security-nav";

export default function AccountRecoveryPage() {
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ["security", "recovery-requests"], queryFn: () => apiFetch<{ requests: Array<{ id: string; status: string; createdAt: string }> }>("/api/security/recovery/requests") });
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: () => apiFetch<{ message: string; devToken?: string }>("/api/security/recovery/request", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: (result) => { setMessage(result.message + (result.devToken ? ` Dev token: ${result.devToken}` : "")); void queryClient.invalidateQueries({ queryKey: ["security", "recovery-requests"] }); },
  });
  const complete = useMutation({
    mutationFn: () => apiFetch<{ redirectTo: string }>("/api/security/recovery/complete", { method: "POST", body: JSON.stringify({ token, newPassword: password, confirmPassword }) }),
    onSuccess: () => { setMessage("Recovery complete. All sessions were signed out. Please sign in again."); setToken(""); setPassword(""); },
  });
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Security Centre</p><h1 className="mt-2 font-display text-3xl font-semibold text-navy">Account recovery</h1></div>
      <SecurityNav />
      <p className="text-xs text-muted-foreground">Recovery uses short-lived, single-use tokens. Responses do not reveal whether an account exists. No identity verification is performed.</p>
      <Card><CardHeader><CardTitle className="text-base">Request recovery</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
        <Input className="w-72" placeholder="Account email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button disabled={request.isPending || !email} onClick={() => request.mutate()}>Request</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Complete recovery</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" placeholder="Recovery token" value={token} onChange={(e) => setToken(e.target.value)} />
        <Input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        <Button className="sm:col-span-2" disabled={complete.isPending || !token || passwordSchema.safeParse(password).success === false || password !== confirmPassword} onClick={() => complete.mutate()}>Complete recovery</Button>
      </CardContent></Card>
      {message ? <p className="text-sm text-primary">{message}</p> : null}
      <Card><CardHeader><CardTitle className="text-base">Recent requests</CardTitle></CardHeader><CardContent>
        {(requests.data?.requests ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No recovery requests.</p> : requests.data?.requests.map((r) => (
          <div key={r.id} className="flex justify-between border-b border-border/70 py-2 text-xs"><span>{r.status}</span><span>{new Date(r.createdAt).toLocaleString("en-IN")}</span></div>
        ))}
      </CardContent></Card>
    </div>
  );
}
