import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { countUnresolvedFunding } from "@/lib/payments/funding-service";
import { countUnresolvedPayments } from "@/lib/payments/payment-service";
import { getMonthlySummary, getRecentTransactions } from "@/lib/payments/transaction-service";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { WalletDashboard } from "./wallet-dashboard";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function HomePage() {
  const auth = await requireOnboardedUser("/home");
  const overview = await getWalletOverviewForUser(auth.user.id);
  const currency = overview?.wallet.currency ?? "INR";

  const [recentTransactions, monthlySummary, unresolvedPayments, unresolvedFunding] =
    await Promise.all([
      getRecentTransactions(auth.user.id, 5),
      getMonthlySummary(auth.user.id, currency),
      countUnresolvedPayments(auth.user.id),
      countUnresolvedFunding(auth.user.id),
    ]);

  return (
    <WalletDashboard
      displayName={auth.profile.displayName}
      initialOverview={overview}
      initialTransactions={recentTransactions}
      monthlySummary={monthlySummary}
      unresolvedPayments={unresolvedPayments}
      unresolvedFunding={unresolvedFunding}
    />
  );
}
