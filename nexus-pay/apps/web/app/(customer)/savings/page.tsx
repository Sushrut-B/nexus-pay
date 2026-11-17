import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { SavingsView } from "./savings-view";

export const metadata: Metadata = { title: "Savings goals" };

export default async function SavingsPage() {
  await requireOnboardedUser("/savings");
  return <SavingsView />;
}

