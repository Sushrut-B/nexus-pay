import { NextResponse } from "next/server";
import { probeAllNodes } from "@/lib/raft/leader-discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const nodes = await probeAllNodes();
    return NextResponse.json({
      nodes,
      timestamp: Date.now(),
      totalNodes: nodes.length,
      reachableNodes: nodes.filter((n) => n.reachable).length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to probe nodes";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

