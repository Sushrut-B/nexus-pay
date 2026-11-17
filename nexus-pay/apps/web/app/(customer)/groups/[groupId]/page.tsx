import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/response";
import {
  getGroupBalances,
  getSuggestedSettlements,
} from "@/lib/social/group-balance-service";
import {
  getGroupDetail,
} from "@/lib/social/group-service";
import { listExpenses } from "@/lib/social/expense-service";
import { listSettlements } from "@/lib/social/settlement-service";
import { listGroupActivity } from "@/lib/social/activity-service";
import { GroupDetailView } from "./group-detail-view";

export const metadata: Metadata = {
  title: "Group detail",
};

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const auth = await requireOnboardedUser(`/groups/${groupId}`);
  try {
    const [group, expenses, balances, suggestions, settlements, activity] = await Promise.all([
      getGroupDetail(auth.user.id, groupId),
      listExpenses(auth.user.id, groupId),
      getGroupBalances(groupId),
      getSuggestedSettlements(groupId),
      listSettlements(auth.user.id, groupId),
      listGroupActivity(auth.user.id, groupId),
    ]);

    return (
      <GroupDetailView
        initialGroup={group}
        initialExpenses={expenses}
        initialBalances={balances}
        initialSuggestions={suggestions}
        initialSettlements={settlements}
        initialActivity={activity}
        viewerId={auth.user.id}
      />
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
