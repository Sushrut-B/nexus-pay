import { NextResponse } from "next/server";
import { discoverLeader } from "@/lib/raft/leader-discovery";
import { raftRequest } from "@/lib/raft/client";
import { ClusterNodeStatus } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const leader = await discoverLeader();
    const status = await raftRequest<ClusterNodeStatus>("/v1/cluster/status");
    return NextResponse.json({
      ...status,
      discoveredLeaderUrl: leader.leaderUrl,
      discoveredLeaderId: leader.leaderId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Cluster unreachable";
    return NextResponse.json(
      { error: msg, role: "FOLLOWER", reachable: false },
      { status: 503 }
    );
  }
}

