"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@nexus/validation";
import { Alert, AlertDescription } from "@nexus/ui";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push(result.redirectTo);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields.password) {
          form.setError("password", { message: error.fields.password });
        }
        setFormError(error.message);
      } else {
        setFormError("We could not reset your password. Please request a new link.");
      }
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" {...form.register("token")} />

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          New password
        </label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          placeholder="Create a strong password"
          aria-invalid={Boolean(errors.password)}
          {...form.register("password")}
        />
        {errors.password ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {errors.password.message}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Use upper and lower case letters, a number and a symbol.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
          Confirm new password
        </label>
        <PasswordInput
          id="confirmPassword"
          autoComplete="new-password"
          placeholder="Repeat your password"
          aria-invalid={Boolean(errors.confirmPassword)}
          {...form.register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>

      <SubmitButton pending={form.formState.isSubmitting} pendingLabel="Updating password…">
        Update password
      </SubmitButton>
    </form>
  );
}
