import type { Metadata } from "next";
import { FinanceNav } from "@/components/finance/finance-nav";

export const metadata: Metadata = { title: "Nexus Pay Financial Intelligence" };

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <FinanceNav />
      {children}
    </div>
  );
}
