import type { Metadata } from "next";
import { OverviewView } from "./overview-view";

export const metadata: Metadata = { title: "Control overview" };

export default function ControlOverviewPage() {
  return <OverviewView />;
}
