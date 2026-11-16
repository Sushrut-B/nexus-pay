import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentAccount } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const funded = await raftRequest<PaymentAccount>("/v1/payments/account/fund", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(funded);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fund account";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

