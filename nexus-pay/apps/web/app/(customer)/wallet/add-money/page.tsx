import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { getFundingHistory } from "@/lib/payments/transaction-service";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { AddMoneyForm } from "./add-money-form";

export const metadata: Metadata = {
  title: "Add money",
};

export default async function AddMoneyPage() {
  const auth = await requireOnboardedUser("/wallet/add-money");
  const [overview, recentFunding] = await Promise.all([
    getWalletOverviewForUser(auth.user.id),
    getFundingHistory(auth.user.id, 4),
  ]);

  return <AddMoneyForm overview={overview} recentFunding={recentFunding} />;
}
