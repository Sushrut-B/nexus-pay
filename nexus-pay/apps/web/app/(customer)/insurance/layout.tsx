import type { Metadata } from "next";
import { InsuranceNav } from "@/components/insurance/insurance-nav";

export const metadata: Metadata = { title: "Nexus Pay Insurance" };

export default function InsuranceLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><InsuranceNav />{children}</div>;
}
