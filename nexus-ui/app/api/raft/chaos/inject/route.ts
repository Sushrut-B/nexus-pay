import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { ChaosEvent } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = await raftRequest<ChaosEvent>("/v1/chaos/inject", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(event);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Chaos injection failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

