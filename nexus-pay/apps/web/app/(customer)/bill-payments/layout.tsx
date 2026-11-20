import type { Metadata } from "next";
import { BillingNav } from "@/components/billing/billing-nav";

export const metadata: Metadata = { title: "Nexus Pay Bill Payments" };

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><BillingNav />{children}</div>;
}
