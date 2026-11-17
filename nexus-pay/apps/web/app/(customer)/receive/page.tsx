import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { getReceiveProfile } from "@/lib/payments/recipient-service";
import { ReceiveView } from "./receive-view";

export const metadata: Metadata = {
  title: "Receive money",
};

export default async function ReceivePage() {
  const auth = await requireOnboardedUser("/receive");
  const profile = await getReceiveProfile(auth.user.id);

  return <ReceiveView profile={profile} />;
}
