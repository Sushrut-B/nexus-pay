import type { Metadata } from "next";
import { InvestmentsNav } from "@/components/investments/investments-nav";

export const metadata: Metadata = { title: "Nexus Pay Investments" };

export default function InvestmentsLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><InvestmentsNav />{children}</div>;
}
