"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterInput } from "@nexus/validation";
import { Alert, AlertDescription } from "@nexus/ui";
import { FormField } from "@/components/forms/form-field";
import { PasswordInput } from "@/components/forms/password-input";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

type FieldName = keyof RegisterInput;

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phoneNumber: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push(result.redirectTo);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const field of ["fullName", "email", "phoneNumber", "username", "password"] as FieldName[]) {
          if (error.fields[field]) {
            form.setError(field, { message: error.fields[field] });
          }
        }
        setFormError(error.message);
      } else {
        setFormError("We could not create your account. Please try again.");
      }
    }
  }

  const errors = form.formState.errors;
  const pending = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="fullName"
        label="Full name"
        autoComplete="name"
        placeholder="Aarav Sharma"
        error={errors.fullName?.message}
        {...form.register("fullName")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...form.register("email")}
        />
        <FormField
          id="phoneNumber"
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="98765 43210"
          hint="Indian numbers may omit +91."
          error={errors.phoneNumber?.message}
          {...form.register("phoneNumber")}
        />
      </div>

      <FormField
        id="username"
        label="Username"
        autoComplete="username"
        placeholder="aarav_sharma"
        hint="Letters, numbers and underscores. You can change this later only during profile setup."
        error={errors.username?.message}
        {...form.register("username")}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <span className="text-xs text-muted-foreground">10+ characters</span>
        </div>
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
          Confirm password
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

      <p className="text-xs leading-relaxed text-muted-foreground">
        By creating an account you agree to use Nexus Pay responsibly. We store only the account
        details needed to operate your wallet.
      </p>

      <SubmitButton pending={pending} pendingLabel="Creating your account…">
        Create account
      </SubmitButton>

      <p className="text-center text-xs text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
