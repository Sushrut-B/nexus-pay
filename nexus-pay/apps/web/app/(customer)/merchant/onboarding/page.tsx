import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { OnboardingView } from "./onboarding-view";

export const metadata: Metadata = { title: "Start accepting payments" };

export default async function MerchantOnboardingPage() {
  const auth = await requireOnboardedUser("/merchant/onboarding");
  return <OnboardingView displayName={auth.profile.displayName} />;
}

