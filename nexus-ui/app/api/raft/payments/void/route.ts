import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await raftRequest<{ status: string; holdId: string }>(
      "/v1/payments/void",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Void hold failed";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}

