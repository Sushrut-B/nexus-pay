"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import type { AuthMethodView } from "@nexus/shared-types";
import { SecurityNav } from "@/components/security/security-nav";
import { toast } from "sonner";

export default function AuthenticationMethodsPage() {
  const queryClient = useQueryClient();
  const methods = useQuery({ queryKey: ["security", "methods"], queryFn: () => apiFetch<{ methods: AuthMethodView[] }>("/api/security/methods") });
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<{ enrollmentId: string; secret: string; provisioningUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");

  const stepUp = (target: string) => apiFetch<{ grantToken: string }>("/api/security/step-up", {
    method: "POST", body: JSON.stringify({ action: target, password }),
  });

  const enroll = useMutation({
    mutationFn: async () => {
      const grant = await stepUp("MFA_ENROLL");
      return apiFetch<{ enrollmentId: string; secret: string; provisioningUri: string }>("/api/security/mfa/enroll", {
        method: "POST", body: JSON.stringify({ grantToken: grant.grantToken }),
      });
    },
    onSuccess: (result) => { setEnrollment(result); setPassword(""); },
  });
  const confirm = useMutation({
    mutationFn: () => apiFetch<{ codes: string[] }>("/api/security/mfa/confirm", {
      method: "POST", body: JSON.stringify({ enrollmentId: enrollment!.enrollmentId, code }),
    }),
    onSuccess: (result) => { setCodes(result.codes); setEnrollment(null); setCode(""); void queryClient.invalidateQueries({ queryKey: ["security", "methods"] }); toast.success("Authenticator enabled"); },
  });
  const disable = useMutation({
    mutationFn: async () => {
      const grant = await stepUp("MFA_DISABLE");
      return apiFetch("/api/security/mfa/disable", { method: "POST", body: JSON.stringify({ grantToken: grant.grantToken }) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["security", "methods"] }); toast.success("Authenticator removed"); },
  });
  const regenerate = useMutation({
    mutationFn: async () => {
      const grant = await stepUp("CHANGE_RECOVERY");
      return apiFetch<{ codes: string[] }>("/api/security/mfa/recovery-codes", { method: "POST", body: JSON.stringify({ grantToken: grant.grantToken }) });
    },
    onSuccess: (result) => setCodes(result.codes),
  });

  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Security Centre</p><h1 className="mt-2 font-display text-3xl font-semibold text-navy">Authentication methods</h1></div>
      <SecurityNav />
      <p className="text-xs text-muted-foreground">TOTP uses a standard authenticator app. Passkeys/WebAuthn are unavailable in this release. This is not identity verification.</p>
      <Card><CardHeader><CardTitle className="text-base">Your methods</CardTitle></CardHeader><CardContent>
        {(methods.data?.methods ?? []).map((method) => (
          <div key={method.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-3 text-sm last:border-0">
            <div><p className="font-medium">{method.label ?? method.type}</p><p className="text-xs text-muted-foreground">{method.status} Â· {method.available ? "Available" : "Unavailable"}</p></div>
            <p className="max-w-md text-xs text-muted-foreground">{method.notice}</p>
          </div>
        ))}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Reauthentication</CardTitle></CardHeader><CardContent className="flex flex-wrap items-end gap-3">
        <Input className="w-64" type="password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">Required to enroll, disable or replace a factor.</p>
      </CardContent></Card>
      {!enrollment && !codes ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={enroll.isPending || password.length < 8} onClick={() => enroll.mutate()}>Set up authenticator</Button>
          <Button variant="outline" disabled={regenerate.isPending || password.length < 8} onClick={() => regenerate.mutate()}>Regenerate recovery codes</Button>
          <Button variant="destructive" disabled={disable.isPending || password.length < 8} onClick={() => disable.mutate()}>Remove authenticator</Button>
        </div>
      ) : null}
      {enrollment ? (
        <Card><CardHeader><CardTitle className="text-base">Verify your authenticator</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Add this secret to your authenticator app. It is shown only during enrollment.</p>
          <code className="block break-all rounded bg-secondary p-3 text-xs">{enrollment.secret}</code>
          <p className="break-all text-[11px] text-muted-foreground">{enrollment.provisioningUri}</p>
          <Input className="w-48" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          <Button disabled={confirm.isPending || code.length !== 6} onClick={() => confirm.mutate()}>Activate</Button>
        </CardContent></Card>
      ) : null}
      {codes ? (
        <Card><CardHeader><CardTitle className="text-base">Recovery codes (shown once)</CardTitle></CardHeader><CardContent>
          <div className="grid gap-2 sm:grid-cols-2">{codes.map((value) => <code key={value} className="rounded bg-secondary p-2 text-xs">{value}</code>)}</div>
          <Button className="mt-3" variant="outline" onClick={() => setCodes(null)}>I have saved these codes</Button>
        </CardContent></Card>
      ) : null}
    </div>
  );
}
