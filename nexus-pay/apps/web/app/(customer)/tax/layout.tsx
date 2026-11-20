import type { Metadata } from "next";
import { TaxNav } from "@/components/tax/tax-nav";

export const metadata: Metadata = { title: "Nexus Pay Tax Centre" };

export default function TaxLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><TaxNav />{children}</div>;
}
