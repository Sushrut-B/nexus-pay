import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guards";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { WalletDashboard } from "./wallet-dashboard";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function HomePage() {
  const auth = await requireOnboardedUser("/home");
  const overview = await getWalletOverviewForUser(auth.user.id);

  return (
    <WalletDashboard
      displayName={auth.profile.displayName}
      initialOverview={overview}
    />
  );
}
