"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@nexus/validation";
import { Alert, AlertDescription, Button } from "@nexus/ui";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "", rememberMe: false },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push(result.redirectTo);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields.identifier) {
          form.setError("identifier", { message: error.fields.identifier });
        }
        if (error.fields.password) {
          form.setError("password", { message: error.fields.password });
        }
        setFormError(error.message);
      } else {
        setFormError("We could not sign you in. Please try again.");
      }
    }
  }

  const pending = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="identifier"
        label="Email or username"
        autoComplete="username"
        placeholder="you@example.com"
        error={form.formState.errors.identifier?.message}
        {...form.register("identifier")}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          aria-invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
        {form.formState.errors.password ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
          {...form.register("rememberMe")}
        />
        Keep me signed in on this device
      </label>

      <SubmitButton pending={pending} pendingLabel="Signing in…">
        Sign in
      </SubmitButton>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/register">New to Nexus Pay? Create an account</Link>
      </Button>
    </form>
  );
}
