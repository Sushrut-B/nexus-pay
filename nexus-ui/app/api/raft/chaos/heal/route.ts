import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const peer = req.nextUrl.searchParams.get("peer");
    let url = "/v1/chaos/heal?all=true";
    if (peer) {
      url = `/v1/chaos/heal?peer=${encodeURIComponent(peer)}`;
    }
    const result = await raftRequest<{ status: string }> (url, {
      method: "POST",
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Chaos heal failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

