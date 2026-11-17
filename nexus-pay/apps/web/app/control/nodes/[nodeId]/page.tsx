import type { Metadata } from "next";
import { NodeDetailView } from "./node-detail-view";

export const metadata: Metadata = { title: "Node details" };

export default async function NodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  return <NodeDetailView nodeId={nodeId} />;
}
