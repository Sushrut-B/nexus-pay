import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await requireOnboardedUser("/calendar");
  return <CalendarView />;
}

