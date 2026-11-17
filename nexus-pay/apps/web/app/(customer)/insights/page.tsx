import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { InsightsView } from "./insights-view";

export const metadata: Metadata = {
  title: "Financial insights",
};

export default async function InsightsPage() {
  const auth = await requireOnboardedUser("/insights");
  return <InsightsView displayName={auth.profile.displayName} />;
}
