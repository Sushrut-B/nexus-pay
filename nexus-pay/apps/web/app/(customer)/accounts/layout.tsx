import type { Metadata } from "next";
import { AccountsNav } from "@/components/accounts/accounts-nav";

export const metadata: Metadata = { title: "Nexus Pay Accounts" };

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><AccountsNav />{children}</div>;
}
