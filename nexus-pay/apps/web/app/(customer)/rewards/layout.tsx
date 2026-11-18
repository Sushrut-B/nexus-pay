import type { Metadata } from "next";
import { RewardsNav } from "@/components/rewards/rewards-nav";

export const metadata: Metadata = { title: "Nexus Pay Rewards" };

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <RewardsNav />
      {children}
    </div>
  );
}
