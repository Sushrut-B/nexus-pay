import type { Metadata } from "next";
import { TravelNav } from "@/components/travel/travel-nav";

export const metadata: Metadata = { title: "Nexus Pay Travel" };

export default function TravelLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><TravelNav />{children}</div>;
}
