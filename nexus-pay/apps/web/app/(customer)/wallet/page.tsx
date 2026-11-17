import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import {
  getFundingHistory,
  getRecentTransactions,
} from "@/lib/payments/transaction-service";
import { listWalletOverviewsForUser } from "@/lib/wallet/service";
import { WalletView } from "./wallet-view";

export const metadata: Metadata = {
  title: "Wallet",
};

export default async function WalletPage() {
  const auth = await requireOnboardedUser("/wallet");
  const [wallets, fundingHistory, recentActivity] = await Promise.all([
    listWalletOverviewsForUser(auth.user.id),
    getFundingHistory(auth.user.id, 8),
    getRecentTransactions(auth.user.id, 6),
  ]);

  return (
    <WalletView
      initialWallets={wallets}
      fundingHistory={fundingHistory}
      recentActivity={recentActivity}
    />
  );
}
