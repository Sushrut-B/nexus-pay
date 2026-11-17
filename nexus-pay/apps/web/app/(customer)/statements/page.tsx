import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { StatementsView } from "./statements-view";

export const metadata: Metadata = { title: "Statements" };

export default async function StatementsPage() {
  await requireOnboardedUser("/statements");
  return <StatementsView />;
}

