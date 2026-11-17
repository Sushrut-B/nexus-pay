"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileUpdateSchema, type ProfileUpdateInput } from "@nexus/validation";
import { Alert, AlertDescription } from "@nexus/ui";
import { SUPPORTED_LANGUAGES } from "@nexus/shared-types";
import { toast } from "sonner";
import { FormField } from "@/components/forms/form-field";
import { SelectField } from "@/components/forms/select-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

const LANGUAGE_LABELS: Record<(typeof SUPPORTED_LANGUAGES)[number], string> = {
  "en-IN": "English (India)",
  "hi-IN": "हिन्दी (भारत)",
  "en-US": "English (United States)",
};

export function ProfileForm({
  initialDisplayName,
  initialLanguage,
}: {
  initialDisplayName: string;
  initialLanguage: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileUpdateInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: initialDisplayName,
      preferredLanguage: initialLanguage as ProfileUpdateInput["preferredLanguage"],
    },
  });

  async function onSubmit(values: ProfileUpdateInput) {
    setFormError(null);
    try {
      await apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      toast.success("Profile updated.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.fields.displayName) {
          form.setError("displayName", { message: error.fields.displayName });
        }
        setFormError(error.message);
      } else {
        setFormError("We could not update your profile. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="displayName"
        label="Display name"
        autoComplete="name"
        error={form.formState.errors.displayName?.message}
        {...form.register("displayName")}
      />

      <SelectField
        id="preferredLanguage"
        label="Preferred language"
        options={SUPPORTED_LANGUAGES.map((language) => ({
          value: language,
          label: LANGUAGE_LABELS[language],
        }))}
        error={form.formState.errors.preferredLanguage?.message}
        {...form.register("preferredLanguage")}
      />

      <div className="flex justify-end">
        <SubmitButton
          pending={form.formState.isSubmitting}
          pendingLabel="Saving changes…"
          className="sm:w-auto sm:min-w-[160px]"
        >
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
