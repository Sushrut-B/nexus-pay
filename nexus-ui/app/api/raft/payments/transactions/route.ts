import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentResult } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

interface TransactionsResponse {
  tenantId: string;
  count: number;
  transactions: PaymentResult[];
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId") || "default";
    const ref = req.nextUrl.searchParams.get("ref");
    const limit = req.nextUrl.searchParams.get("limit") || "50";

    let url = `/v1/payments/transactions?tenantId=${encodeURIComponent(tenantId)}&limit=${encodeURIComponent(limit)}`;
    if (ref) {
      url += `&ref=${encodeURIComponent(ref)}`;
    }

    const data = await raftRequest<TransactionsResponse | PaymentResult>(url);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load transactions";
    return NextResponse.json(
      { error: msg, transactions: [], count: 0 },
      { status: 500 }
    );
  }
}

