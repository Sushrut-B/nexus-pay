"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { onboardingSchema, type OnboardingInput } from "@nexus/validation";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@nexus/ui";
import { CURRENCY_LABELS, SUPPORTED_CURRENCIES, SUPPORTED_LANGUAGES } from "@nexus/shared-types";
import { FormField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

const LANGUAGE_LABELS: Record<(typeof SUPPORTED_LANGUAGES)[number], string> = {
  "en-IN": "English (India)",
  "hi-IN": "हिन्दी (भारत)",
  "en-US": "English (United States)",
};

export function OnboardingForm({ initialValues }: { initialValues: OnboardingInput }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: initialValues,
  });

  async function onSubmit(values: OnboardingInput) {
    setFormError(null);
    try {
      const result = await apiFetch<{ redirectTo: string }>("/api/onboarding", {
        method: "POST",
        body: JSON.stringify(values),
      });
      router.push(result.redirectTo);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields.username) {
          form.setError("username", { message: error.fields.username });
        }
        if (error.fields.displayName) {
          form.setError("displayName", { message: error.fields.displayName });
        }
        setFormError(error.message);
      } else {
        setFormError("We could not save your details. Please try again.");
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

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>How you appear inside Nexus Pay.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="displayName"
            label="Display name"
            autoComplete="name"
            placeholder="Aarav"
            error={errors.displayName?.message}
            {...form.register("displayName")}
          />
          <FormField
            id="username"
            label="Username"
            autoComplete="username"
            placeholder="aarav_sharma"
            hint="Letters, numbers and underscores."
            error={errors.username?.message}
            {...form.register("username")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wallet preferences</CardTitle>
          <CardDescription>These settings shape your first wallet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="preferredCurrency"
              label="Wallet currency"
              error={errors.preferredCurrency?.message}
              options={SUPPORTED_CURRENCIES.map((currency) => ({
                value: currency,
                label: `${currency} — ${CURRENCY_LABELS[currency]}`,
              }))}
              {...form.register("preferredCurrency")}
            />
            <SelectField
              id="preferredLanguage"
              label="Preferred language"
              error={errors.preferredLanguage?.message}
              options={SUPPORTED_LANGUAGES.map((language) => ({
                value: language,
                label: LANGUAGE_LABELS[language],
              }))}
              {...form.register("preferredLanguage")}
            />
          </div>

          <Separator />

          <Alert variant="info">
            <AlertDescription>
              Your wallet currency cannot be changed after setup. Choose the currency you use for
              everyday spending.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your wallet account is created on the Raftline ledger and verified before it is marked
          active.
        </p>
        <SubmitButton
          pending={form.formState.isSubmitting}
          pendingLabel="Creating your wallet…"
          className="sm:w-auto sm:min-w-[200px]"
        >
          Finish setup
        </SubmitButton>
      </div>
    </form>
  );
}
