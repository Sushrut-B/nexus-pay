import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentResult } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.idempotencyKey) {
      return NextResponse.json(
        { error: "idempotencyKey is required for financial settlement" },
        { status: 400 }
      );
    }
    if (!body.sourceAccountId || !body.destinationAccountId) {
      return NextResponse.json(
        { error: "sourceAccountId and destinationAccountId are required" },
        { status: 400 }
      );
    }
    if (!body.amountCents || body.amountCents <= 0) {
      return NextResponse.json(
        { error: "amountCents must be a positive integer" },
        { status: 400 }
      );
    }

    const result = await raftRequest<PaymentResult>("/v1/payments/settle", {
      method: "POST",
      idempotencyKey: body.idempotencyKey,
      body: JSON.stringify(body),
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Settlement failed";
    // Check if error contains rejection reason from backend
    return NextResponse.json(
      {
        status: "REJECTED",
        rejectionReason: msg,
        error: msg,
      },
      { status: 422 }
    );
  }
}

