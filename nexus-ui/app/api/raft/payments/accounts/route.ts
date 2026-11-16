import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";
import { PaymentAccount } from "@/lib/raft/types";

export const dynamic = "force-dynamic";

interface AccountsResponse {
  tenantId: string;
  count: number;
  accounts: PaymentAccount[];
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId") || "default";
    const data = await raftRequest<AccountsResponse>(
      `/v1/payments/accounts?tenantId=${encodeURIComponent(tenantId)}`
    );

    // If demo profiles are missing, ensure all 4 standard accounts exist
    const accounts = data.accounts || [];
    const hasAlice = accounts.some((a) => a.accountId.includes("alice"));
    const hasBob = accounts.some((a) => a.accountId.includes("bob"));
    const hasCharlie = accounts.some((a) => a.accountId.includes("charlie"));
    const hasDeepak = accounts.some((a) => a.accountId.includes("deepak"));

    if (!hasAlice || !hasBob || !hasCharlie || !hasDeepak) {
      try {
        if (!hasCharlie) {
          await raftRequest("/v1/payments/accounts", {
            method: "POST",
            body: JSON.stringify({
              accountId: "acc_charlie_sepa",
              currency: "EUR",
              initialBalanceCents: 250000,
              metadata: { holder: "Charlie Dupont", type: "SEPA Vendor" },
            }),
          });
        }
        if (!hasDeepak) {
          await raftRequest("/v1/payments/accounts", {
            method: "POST",
            body: JSON.stringify({
              accountId: "acc_deepak_upi",
              currency: "INR",
              initialBalanceCents: 7500000,
              metadata: { holder: "Deepak Patel", type: "UPI Tech Vendor" },
            }),
          });
        }
        if (!hasAlice) {
          await raftRequest("/v1/payments/accounts", {
            method: "POST",
            body: JSON.stringify({
              accountId: "acc_alice_fednow",
              currency: "USD",
              initialBalanceCents: 100000,
              metadata: { holder: "Alice Smith", type: "Consumer Checking" },
            }),
          });
        }
        if (!hasBob) {
          await raftRequest("/v1/payments/accounts", {
            method: "POST",
            body: JSON.stringify({
              accountId: "acc_bob_fednow",
              currency: "USD",
              initialBalanceCents: 50000,
              metadata: { holder: "Bob Jones Corp", type: "Merchant Operating" },
            }),
          });
        }
        // Refetch after provisioning
        const refreshed = await raftRequest<AccountsResponse>(
          `/v1/payments/accounts?tenantId=${encodeURIComponent(tenantId)}`
        );
        return NextResponse.json(refreshed);
      } catch {
        // Fallback to original list
      }
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load accounts";
    return NextResponse.json({ error: msg, accounts: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await raftRequest<PaymentAccount>("/v1/payments/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create account";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

