"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@nexus/validation";
import { Alert, AlertDescription, AlertTitle } from "@nexus/ui";
import { FormField } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; devResetUrl?: string } | null>(null);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (!result) form.reset();
  }, [form, result]);

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    try {
      const data = await apiFetch<{ message: string; devResetUrl?: string }>(
        "/api/auth/forgot-password",
        {
          method: "POST",
          body: JSON.stringify(values),
        },
      );
      setResult(data);
    } catch (error) {
      setFormError(
        error instanceof ApiClientError
          ? error.message
          : "We could not process the request. Please try again.",
      );
    }
  }

  if (result) {
    return (
      <div className="space-y-5">
        <Alert variant="success">
          <AlertTitle>Check your email</AlertTitle>
          <AlertDescription>
            <p>{result.message}</p>
          </AlertDescription>
        </Alert>

        {result.devResetUrl ? (
          <Alert variant="info">
            <AlertTitle>Development reset link</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Email delivery is optional in local development. Use this single-use link to
                continue:
              </p>
              <Link
                href={result.devResetUrl}
                className="break-all font-medium text-primary underline underline-offset-4"
              >
                Open password reset link
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Didn&apos;t receive anything? Check your spam folder or try again in a few minutes.
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          Use a different email address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="email"
        label="Email address"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        error={form.formState.errors.email?.message}
        {...form.register("email")}
      />

      <SubmitButton pending={form.formState.isSubmitting} pendingLabel="Sending reset link…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
