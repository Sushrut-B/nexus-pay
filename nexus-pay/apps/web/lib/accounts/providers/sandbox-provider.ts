import { createHash } from "node:crypto";
import { appBaseUrl } from "@/lib/env";
import { encryptSecret } from "@/lib/security/crypto";
import type {
  CallbackResult, InitiateInput, InitiateResult, ProviderAdapter, ProviderBalanceData,
  ProviderContext, ProviderTransactionData,
} from "@/lib/accounts/provider-adapter";

const SANDBOX_NOTICE =
  "SANDBOX TEST PROVIDER — no bank, UPI, card or Account Aggregator connection exists. All data shown is deterministic test data and must not be treated as real financial information.";

function sandboxRef(seed: string): string {
  return `sandbox_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

/** Clearly labelled test adapter. Enabled only by NEXUS_EXTERNAL_SANDBOX_ENABLED. */
export class SandboxProviderAdapter implements ProviderAdapter {
  readonly code = "sandbox";
  readonly displayName = "Sandbox Test Provider";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = {
    balances: true, transactions: true, incrementalSync: true,
    refreshConsent: true, revokeConsent: true, hostedAuth: false,
  };

  async initiateConnection(input: InitiateInput): Promise<InitiateResult> {
    const providerConnectionRef = sandboxRef(`${input.userId}:${input.state}`);
    const url = new URL("/api/accounts/callback", appBaseUrl());
    url.searchParams.set("state", input.state);
    url.searchParams.set("code", `sandbox:${providerConnectionRef}`);
    url.searchParams.set("providerRef", providerConnectionRef);
    return {
      authorizationUrl: url.toString(),
      providerConnectionRef,
      status: "AWAITING_USER_AUTHORIZATION",
      notice: SANDBOX_NOTICE,
    };
  }

  verifyCallback(input: { state: string; code?: string; providerRef?: string }): boolean {
    return Boolean(input.code?.startsWith("sandbox:") && input.providerRef && input.state);
  }

  async handleCallback(input: { state: string; code?: string; providerRef?: string }): Promise<CallbackResult> {
    const providerConnectionRef = input.providerRef ?? input.code?.replace("sandbox:", "") ?? sandboxRef(input.state);
    return {
      providerConnectionRef,
      encryptedToken: encryptSecret(`sandbox-token:${providerConnectionRef}`),
      accounts: [
        {
          providerAccountRef: `${providerConnectionRef}:savings`,
          accountType: "SAVINGS",
          institutionName: "Sandbox Test Bank",
          maskedIdentifier: "XXXX4821",
          currency: "INR",
          secretReference: `sandbox-account:${providerConnectionRef}:savings`,
        },
        {
          providerAccountRef: `${providerConnectionRef}:credit`,
          accountType: "CREDIT_CARD",
          institutionName: "Sandbox Test Bank",
          maskedIdentifier: "XXXX9012",
          currency: "INR",
          secretReference: `sandbox-account:${providerConnectionRef}:credit`,
        },
      ],
    };
  }

  async fetchAccounts(ctx: ProviderContext) {
    return this.handleCallback({ state: ctx.providerConnectionRef, providerRef: ctx.providerConnectionRef }).then((r) => r.accounts);
  }

  async fetchBalances(ctx: ProviderContext): Promise<ProviderBalanceData[]> {
    const reportedAt = new Date();
    return [
      {
        providerAccountRef: `${ctx.providerConnectionRef}:savings`,
        reportedBalanceMinor: 125_000_00,
        availableBalanceMinor: 120_000_00,
        currency: "INR",
        reportedAt,
        liability: false,
      },
      {
        providerAccountRef: `${ctx.providerConnectionRef}:credit`,
        reportedBalanceMinor: 18_500_00,
        currency: "INR",
        reportedAt,
        liability: true,
        outstandingMinor: 18_500_00,
        availableCreditMinor: 81_500_00,
        statementMinor: 16_000_00,
        minimumDueMinor: 500_00,
        paymentDueDate: new Date(Date.now() + 15 * 86_400_000),
      },
    ];
  }

  async fetchTransactions(ctx: ProviderContext, cursor?: string | null): Promise<{
    transactions: ProviderTransactionData[]; nextCursor: string | null;
  }> {
    // First sync imports a fixed historical set; subsequent incremental calls
    // return no new records unless the sandbox cursor explicitly requests them.
    if (cursor && cursor !== "initial") {
      return { transactions: [], nextCursor: cursor };
    }
    const now = Date.now();
    const savings = `${ctx.providerConnectionRef}:savings`;
    const credit = `${ctx.providerConnectionRef}:credit`;
    const rows: ProviderTransactionData[] = [
      {
        providerTxRef: `${savings}:tx1`, amountMinor: 100_000_00, currency: "INR", direction: "IN",
        description: "Sandbox salary credit", merchant: "Sandbox Employer", category: "INCOME",
        transactionAt: new Date(now - 12 * 86_400_000), postedAt: new Date(now - 12 * 86_400_000), status: "POSTED",
      },
      {
        providerTxRef: `${savings}:tx2`, amountMinor: 2_000_00, currency: "INR", direction: "OUT",
        description: "Sandbox grocery purchase", merchant: "Sandbox Market", category: "GROCERIES",
        transactionAt: new Date(now - 9 * 86_400_000), postedAt: new Date(now - 8 * 86_400_000), status: "POSTED",
      },
      {
        providerTxRef: `${savings}:tx3`, amountMinor: 10_000_00, currency: "INR", direction: "OUT",
        description: "Sandbox transfer to own current account", merchant: null, category: "TRANSFER",
        transactionAt: new Date(now - 5 * 86_400_000), status: "POSTED",
      },
      {
        providerTxRef: `${credit}:tx1`, amountMinor: 3_500_00, currency: "INR", direction: "OUT",
        description: "Sandbox card purchase", merchant: "Sandbox Store", category: "SHOPPING",
        transactionAt: new Date(now - 6 * 86_400_000), postedAt: new Date(now - 5 * 86_400_000), status: "POSTED",
      },
      {
        providerTxRef: `${credit}:tx2`, amountMinor: 1_200_00, currency: "INR", direction: "OUT",
        description: "Sandbox fuel purchase", merchant: "Sandbox Fuel", category: "TRANSPORT",
        transactionAt: new Date(now - 2 * 86_400_000), status: "PENDING",
      },
    ];
    return { transactions: rows, nextCursor: "initial" };
  }

  async refreshConsent(): Promise<void> { /* sandbox no-op */ }
  async revokeConsent(): Promise<void> { /* sandbox no-op */ }
  async getStatus(): Promise<string> { return "AVAILABLE"; }
}

export { SANDBOX_NOTICE };
