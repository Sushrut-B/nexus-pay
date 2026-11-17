"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@nexus/ui";
import { ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminLoginSchema, type AdminLoginInput } from "@nexus/validation";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function ControlLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AdminLoginInput>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const login = useMutation({
    mutationFn: (values: AdminLoginInput) =>
      apiFetch<{ role: string }>("/api/control/auth/login", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["control"] });
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/control") ? next : "/control");
    },
    onError: (error) =>
      setFormError(error instanceof ApiClientError ? error.message : "Administrator sign-in failed."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white">N</span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-white">NEXUS CONTROL</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Infrastructure operations</p>
          </div>
        </div>
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-slate-900">
              <ShieldCheck className="h-5 w-5 text-blue-600" aria-hidden="true" /> Administrator sign in
            </CardTitle>
            <CardDescription>Restricted access. All actions are attributed and audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
              <div>
                <Label htmlFor="ctrl-identifier">Email or username</Label>
                <Input id="ctrl-identifier" className="mt-1.5" autoComplete="username" {...form.register("identifier")} />
                {form.formState.errors.identifier ? (
                  <p className="mt-1 text-xs text-red-600">{form.formState.errors.identifier.message}</p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="ctrl-password">Password</Label>
                <Input id="ctrl-password" type="password" className="mt-1.5" autoComplete="current-password" {...form.register("password")} />
                {form.formState.errors.password ? (
                  <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p>
                ) : null}
              </div>
              {formError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p> : null}
              <Button className="w-full" type="submit" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in to Nexus Control"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
