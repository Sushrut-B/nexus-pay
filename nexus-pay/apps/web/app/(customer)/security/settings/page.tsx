"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import { apiFetch } from "@/lib/api/client";
import { toast } from "sonner";

const ACTIONS = ["CHANGE_EMAIL", "CHANGE_PHONE", "CHANGE_PASSWORD", "CHANGE_RECOVERY", "TRUST_DEVICE", "MERCHANT_SETTINGS"];

export default function SecuritySettingsPage() {
  const [action, setAction] = useState(ACTIONS[0]!);
  const [password, setPassword] = useState("");
  const verify = useMutation({
    mutationFn: () => apiFetch("/api/security/verify-sensitive-action", {
      method: "POST", body: JSON.stringify({ action, password }),
    }),
    onSuccess: () => { setPassword(""); toast.success("Verification complete for this action"); },
    onError: () => toast.error("Verification failed"),
  });
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Security settings</h1>
      </div>
      <Alert><AlertDescription>Sensitive changes require re-entering your password. Multi-factor authentication is not implemented; this is an extension point rather than a claim of MFA.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle className="text-base">Verify a sensitive action</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="action">Action</Label>
            <select id="action" value={action} onChange={(event) => setAction(event.target.value)} className="mt-1.5 h-10 w-64 rounded-lg border border-input bg-background px-3 text-sm">
              {ACTIONS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-64" />
          </div>
          <Button disabled={!password || verify.isPending} onClick={() => verify.mutate()}>Verify</Button>
        </CardContent>
      </Card>
    </div>
  );
}
