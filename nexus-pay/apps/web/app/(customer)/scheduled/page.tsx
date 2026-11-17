import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { ScheduledView } from "./scheduled-view";

export const metadata: Metadata = { title: "Scheduled payments" };

export default async function ScheduledPage() {
  await requireOnboardedUser("/scheduled");
  return <ScheduledView />;
}

