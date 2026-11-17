import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { SpendingView } from "./spending-view";

export const metadata: Metadata = {
  title: "Spending analytics",
};

export default async function SpendingPage() {
  await requireOnboardedUser("/insights/spending");
  return <SpendingView />;
}

