import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { getSuggestedSettlements } from "@/lib/social/group-balance-service";
import { getGroupDetail } from "@/lib/social/group-service";
import { SettleView } from "./settle-view";

export const metadata: Metadata = {
  title: "Settle up",
};

export default async function SettlePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ to?: string; amount?: string }>;
}) {
  const { groupId } = await params;
  const { to, amount } = await searchParams;
  const auth = await requireOnboardedUser(`/groups/${groupId}/settle`);
  const [group, suggestions] = await Promise.all([
    getGroupDetail(auth.user.id, groupId),
    getSuggestedSettlements(groupId),
  ]);

  return (
    <SettleView
      group={group}
      suggestions={suggestions}
      initialPayeeId={to ?? ""}
      initialAmountMinor={Number.isSafeInteger(Number(amount)) ? Number(amount) : null}
      viewerId={auth.user.id}
    />
  );
}
