import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentAccount } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const tenantId = req.nextUrl.searchParams.get("tenantId") || "default";

    if (!id) {
      return NextResponse.json({ error: "Missing 'id' parameter" }, { status: 400 });
    }

    const account = await raftRequest<PaymentAccount>(
      `/v1/payments/account?id=${encodeURIComponent(id)}&tenantId=${encodeURIComponent(tenantId)}`
    );
    return NextResponse.json(account);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load account";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

