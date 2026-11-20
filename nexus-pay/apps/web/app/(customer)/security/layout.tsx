import type { Metadata } from "next";
import { SecurityNav } from "@/components/security/security-nav";

export const metadata: Metadata = { title: "Nexus Pay Security" };

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><SecurityNav />{children}</div>;
}
