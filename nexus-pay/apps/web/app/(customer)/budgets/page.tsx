import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { BudgetsView } from "./budgets-view";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  await requireOnboardedUser("/budgets");
  return <BudgetsView />;
}

