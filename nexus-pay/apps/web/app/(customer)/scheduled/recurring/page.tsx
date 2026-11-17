import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { RecurringView } from "./recurring-view";

export const metadata: Metadata = { title: "Recurring payments" };

export default async function RecurringPage() {
  await requireOnboardedUser("/scheduled/recurring");
  return <RecurringView />;
}

