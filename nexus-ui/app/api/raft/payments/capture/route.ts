import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentResult } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await raftRequest<PaymentResult>("/v1/payments/capture", {
      method: "POST",
      idempotencyKey: body.idempotencyKey,
      body: JSON.stringify(body),
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Capture failed";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}

