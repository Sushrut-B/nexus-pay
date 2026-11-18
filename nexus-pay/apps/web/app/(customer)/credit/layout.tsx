import type { Metadata } from "next";
import { CreditNav } from "@/components/credit/credit-nav";

export const metadata: Metadata = { title: "Nexus Pay Credit" };

export default function CreditLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><CreditNav />{children}</div>;
}
