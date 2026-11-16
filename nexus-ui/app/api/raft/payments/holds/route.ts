import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentHold } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

interface HoldsResponse {
  tenantId: string;
  count: number;
  holds: PaymentHold[];
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId") || "default";
    const data = await raftRequest<HoldsResponse>(
      `/v1/payments/holds?tenantId=${encodeURIComponent(tenantId)}`
    );
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load holds";
    return NextResponse.json({ error: msg, holds: [], count: 0 }, { status: 500 });
  }
}

