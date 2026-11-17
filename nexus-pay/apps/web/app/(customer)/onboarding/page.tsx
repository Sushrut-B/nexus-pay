import type { Metadata } from "next";
import type { OnboardingInput } from "@nexus/validation";
import { requireIncompleteOnboarding } from "@/lib/auth/guards";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Set up your wallet",
};

export default async function OnboardingPage() {
  const auth = await requireIncompleteOnboarding();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Step 2 of 2
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.035em] text-navy sm:text-4xl">
          Make Nexus Pay yours
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          Choose how your name appears and the currency for your first wallet. We will create and
          verify the ledger account as soon as you finish.
        </p>
      </div>

      <OnboardingForm
        initialValues={{
          displayName: auth.profile.displayName,
          username: auth.user.username,
          preferredCurrency: auth.profile.preferredCurrency as OnboardingInput["preferredCurrency"],
          preferredLanguage: auth.profile.preferredLanguage as OnboardingInput["preferredLanguage"],
        }}
      />
    </div>
  );
}
