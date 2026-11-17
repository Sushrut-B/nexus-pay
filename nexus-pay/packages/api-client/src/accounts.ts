import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assertSafeAccountId,
  assertSafeIdempotencyKey,
  type RaftlineConfig,
} from "./config";
import { RaftlineError, isNotLeaderError, type RaftlineErrorCode } from "./errors";
import type { HttpTransport, RaftlineHttpResponse } from "./http";
import type { LeaderLocator } from "./leader";
import {
  isRejectedReceipt,
  parseTransactionReceipt,
  type RaftlineTransactionReceipt,
} from "./receipts";

const rawAccountSchema = z.object({
  accountId: z.string().min(1),
  tenantId: z.string().min(1),
  currency: z.string().min(3).max(3),
  balanceCents: z.number().int().finite(),
  reservedCents: z.number().int().finite().default(0),
  availableBalanceCents: z.number().int().finite().optional(),
  status: z.string().min(1),
  createdAt: z.number().int().finite(),
  updatedAt: z.number().int().finite(),
  metadata: z.record(z.string()).default({}),
});

export interface RaftlineAccount {
  accountId: string;
  tenantId: string;
  currency: string;
  balanceCents: number;
  reservedCents: number;
  availableBalanceCents: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, string>;
}

export interface EnsureAccountInput {
  accountId: string;
  currency: string;
  metadata?: Record<string, string>;
}

export interface EnsureAccountResult {
  account: RaftlineAccount;
  created: boolean;
  mode: "existing" | "official" | "kv";
}

export interface SettlePaymentInput {
  idempotencyKey: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  description?: string;
}

export interface FundAccountInput {
  accountId: string;
  amountCents: number;
  idempotencyKey: string;
  currency?: string;
}

export interface FundAccountResult {
  account: RaftlineAccount;
  /** The replicated funding receipt, or null while it is not yet readable. */
  receipt: RaftlineTransactionReceipt | null;
}

export type AccountCreateMode = RaftlineConfig["accountCreateMode"];

interface LeaderResponse {
  response: RaftlineHttpResponse;
  baseUrl: string;
  nodeId: string;
}

const MAX_LEADER_ATTEMPTS = 3;

export class RaftlinePaymentsClient {
  constructor(
    private readonly config: RaftlineConfig,
    private readonly http: HttpTransport,
    private readonly leader: LeaderLocator,
  ) {}

  async getAccount(accountId: string): Promise<RaftlineAccount | null> {
    assertSafeAccountId(accountId);
    const query = new URLSearchParams({
      id: accountId,
      tenantId: this.config.tenantId,
    });
    const { response } = await this.leaderRequest(
      `/v1/payments/account?${query.toString()}`,
      { method: "GET" },
    );

    if (response.status === 404) return null;
    if (response.status === 200) return parseAccount(response.text);
    throw this.responseError(response, "UNAVAILABLE", false);
  }

  /**
   * Executes an internal-book settlement. A 422 is a definitive rejection and is
   * returned as a receipt, not an exception. A 409 means the idempotency key was
   * reused with a different payload; timeout and 5xx outcomes are ambiguous.
   */
  async settlePayment(input: SettlePaymentInput): Promise<RaftlineTransactionReceipt> {
    assertSafeAccountId(input.sourceAccountId);
    assertSafeAccountId(input.destinationAccountId);
    assertSafeIdempotencyKey(input.idempotencyKey);
    this.assertSettlementAmount(input.amountCents);
    const currency = input.currency.toUpperCase();

    const { response } = await this.leaderRequest(
      "/v1/payments/settle",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": this.config.tenantId,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          rail: "INTERNAL_BOOK",
          sourceAccountId: input.sourceAccountId,
          destinationAccountId: input.destinationAccountId,
          amountCents: input.amountCents,
          currency,
          description: input.description ?? "",
          tenantId: this.config.tenantId,
        }),
      },
      this.config.settlementTimeoutMs,
    );

    if (response.status === 200 || response.status === 201) {
      return parseTransactionReceipt(response.text);
    }
    if (response.status === 422) {
      const receipt = parseTransactionReceipt(response.text);
      if (!isRejectedReceipt(receipt)) {
        throw new RaftlineError("Raftline returned an inconsistent rejection receipt", {
          code: "BAD_RESPONSE",
          status: 422,
        });
      }
      return receipt;
    }

    throw this.transformPaymentError(response, "settlement");
  }

  /**
   * Credits a simulated sandbox funding amount. The tenant must be supplied in
   * the header: Raftline ignores a tenantId only supplied in the body here.
   */
  async fundAccount(input: FundAccountInput): Promise<FundAccountResult> {
    assertSafeAccountId(input.accountId);
    assertSafeIdempotencyKey(input.idempotencyKey);
    this.assertSettlementAmount(input.amountCents);

    const { response } = await this.leaderRequest(
      "/v1/payments/account/fund",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": this.config.tenantId,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          accountId: input.accountId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
          tenantId: this.config.tenantId,
        }),
      },
      this.config.settlementTimeoutMs,
    );

    if (response.status === 200 || response.status === 201) {
      const account = parseAccount(response.text);
      this.assertCompatible(account, (input.currency ?? "INR").toUpperCase());
      const receipt = await this.getTransactionEventually(input.idempotencyKey);
      return { account, receipt };
    }

    if (response.status === 404) {
      throw new RaftlineError("The ledger account was not found", {
        code: "NOT_FOUND",
        status: 404,
      });
    }
    throw this.transformPaymentError(response, "funding");
  }

  /**
   * Reads the committed receipt by idempotency key or payment reference.
   * Returns null only for a definitive 404.
   */
  async getTransaction(ref: string): Promise<RaftlineTransactionReceipt | null> {
    const query = new URLSearchParams({
      tenantId: this.config.tenantId,
      ref,
    });
    const { response } = await this.leaderRequest(
      `/v1/payments/transactions?${query.toString()}`,
      { method: "GET" },
    );

    if (response.status === 404) return null;
    if (response.status === 200) return parseTransactionReceipt(response.text);
    if (response.status === 429) {
      throw new RaftlineError("Raftline tenant rate limit reached", {
        code: "RATE_LIMITED",
        status: 429,
      });
    }
    throw this.responseError(response, response.status >= 500 ? "UNAVAILABLE" : "REQUEST_REJECTED", false);
  }

  /**
   * Reads a receipt with a short read-after-write backoff. Used after funding,
   * where the HTTP response returns an account rather than a receipt.
   */
  async getTransactionEventually(ref: string): Promise<RaftlineTransactionReceipt | null> {
    const delays = [0, 150, 400];
    for (const delay of delays) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const receipt = await this.getTransaction(ref);
      if (receipt) return receipt;
    }
    return null;
  }

  private assertSettlementAmount(amountCents: number): void {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new RaftlineError("Payment amount must be a positive integer in minor units", {
        code: "CONFIGURATION",
      });
    }
  }

  private transformPaymentError(
    response: RaftlineHttpResponse,
    operation: "settlement" | "funding",
  ): RaftlineError {
    if (response.status === 409) {
      return new RaftlineError("Raftline reported an idempotency conflict", {
        code: "CONFLICT",
        status: 409,
      });
    }
    if (response.status === 429) {
      return new RaftlineError("Raftline tenant rate limit reached", {
        code: "RATE_LIMITED",
        status: 429,
      });
    }
    if (response.status === 401 || response.status === 403) {
      return new RaftlineError("Raftline rejected the integration credentials", {
        code: "UNAUTHORIZED",
        status: response.status,
      });
    }
    if (response.status === 404) {
      return new RaftlineError("The ledger account was not found", {
        code: "NOT_FOUND",
        status: 404,
      });
    }
    if (response.status >= 500) {
      return new RaftlineError(
        `Raftline ${operation} could not be confirmed`,
        { code: "AMBIGUOUS", status: response.status, ambiguous: true },
      );
    }
    if (response.status === 400 || response.status === 405) {
      return new RaftlineError(`Raftline rejected the ${operation} request`, {
        code: "REQUEST_REJECTED",
        status: response.status,
      });
    }
    return new RaftlineError(`Raftline returned HTTP ${response.status}`, {
      code: "UNAVAILABLE",
      status: response.status,
    });
  }

  async ensureAccount(input: EnsureAccountInput): Promise<EnsureAccountResult> {
    assertSafeAccountId(input.accountId);
    const currency = input.currency.toUpperCase();

    const existing = await this.getAccount(input.accountId);
    if (existing) {
      this.assertCompatible(existing, currency);
      return { account: existing, created: false, mode: "existing" };
    }

    if (this.config.accountCreateMode === "kv") {
      return this.provisionViaKv(input, currency);
    }

    if (this.config.accountCreateMode === "official") {
      await this.createViaOfficialApi(input, currency);
      const verified = await this.verifyEventually(input.accountId);
      if (!verified) {
        throw new RaftlineError(
          "Raftline reported the account as created, but it could not be read back",
          { code: "PROVISIONING_FAILED", ambiguous: true },
        );
      }
      this.assertCompatible(verified, currency);
      return { account: verified, created: true, mode: "official" };
    }

    await this.createViaOfficialApi(input, currency);
    const verified = await this.verifyEventually(input.accountId);
    if (verified) {
      this.assertCompatible(verified, currency);
      return { account: verified, created: true, mode: "official" };
    }

    return this.provisionViaKv(input, currency);
  }

  async getClusterSummary(): Promise<{
    statuses: Awaited<ReturnType<LeaderLocator["statuses"]>>;
    leader: { baseUrl: string; nodeId: string; term: number } | null;
  }> {
    const statuses = await this.leader.statuses();
    const leaderStatus = statuses.find((entry) => entry.status.role === "LEADER");
    return {
      statuses,
      leader: leaderStatus
        ? {
            baseUrl: leaderStatus.baseUrl,
            nodeId: leaderStatus.status.nodeId,
            term: leaderStatus.status.term,
          }
        : null,
    };
  }

  private async createViaOfficialApi(
    input: EnsureAccountInput,
    currency: string,
  ): Promise<RaftlineAccount> {
    const { response } = await this.leaderRequest("/v1/payments/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: input.accountId,
        tenantId: this.config.tenantId,
        currency,
        initialBalanceCents: 0,
        metadata: input.metadata ?? {},
      }),
    });

    if (response.status === 200 || response.status === 201) {
      return parseAccount(response.text);
    }

    if (response.status >= 500) {
      throw this.responseError(response, "AMBIGUOUS", true);
    }

    throw this.responseError(response, "PROVISIONING_FAILED", false);
  }

  private async provisionViaKv(
    input: EnsureAccountInput,
    currency: string,
  ): Promise<EnsureAccountResult> {
    const now = Date.now();
    const record = {
      accountId: input.accountId,
      tenantId: this.config.tenantId,
      currency,
      balanceCents: 0,
      reservedCents: 0,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };

    const key = `pay:acc:${this.config.tenantId}:${input.accountId}`;
    const clientId = `nexuspay-provision-${randomUUID()}`;
    const { response } = await this.leaderRequest(`/v1/kv/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
        "X-Sequence-Number": "1",
      },
      body: JSON.stringify(record),
    });

    if (response.status !== 200) {
      throw this.responseError(response, response.status >= 500 ? "AMBIGUOUS" : "PROVISIONING_FAILED", response.status >= 500);
    }

    const verified = await this.verifyEventually(input.accountId);
    if (!verified) {
      throw new RaftlineError("Compatibility account write could not be verified", {
        code: "AMBIGUOUS",
        ambiguous: true,
      });
    }

    this.assertCompatible(verified, currency);
    return { account: verified, created: true, mode: "kv" };
  }

  private async verifyEventually(accountId: string): Promise<RaftlineAccount | null> {
    const delays = [0, 200, 500];
    let lastError: unknown = null;
    for (const delay of delays) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      try {
        const account = await this.getAccount(accountId);
        if (account) return account;
      } catch (error) {
        lastError = error;
        if (isNotLeaderError(error)) {
          this.leader.invalidate();
          continue;
        }
        throw error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    return null;
  }

  private assertCompatible(account: RaftlineAccount, currency: string): void {
    if (account.tenantId !== this.config.tenantId) {
      throw new RaftlineError("Raftline account belongs to a different tenant", {
        code: "CONFLICT",
      });
    }
    if (account.currency !== currency) {
      throw new RaftlineError("Raftline account currency does not match the wallet currency", {
        code: "CONFLICT",
      });
    }
  }

  private async leaderRequest(
    path: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<LeaderResponse> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_LEADER_ATTEMPTS; attempt += 1) {
      const location = await this.leader.locate(attempt > 0);
      const response = await this.http.request(`${location.baseUrl}${path}`, init, timeoutMs);

      if (isLeaderRedirect(response)) {
        this.leader.invalidate();
        lastError = leaderRedirectError(response);
        continue;
      }

      if (isNotLeaderBody(response)) {
        this.leader.invalidate();
        lastError = new RaftlineError("Raftline node is not the leader", {
          code: "NOT_LEADER",
          status: response.status,
          leaderHint: readLeaderHint(response.text),
        });
        continue;
      }

      return {
        response,
        baseUrl: location.baseUrl,
        nodeId: location.nodeId,
      };
    }

    if (lastError instanceof RaftlineError) throw lastError;
    throw new RaftlineError("Raftline leader could not be reached", { code: "UNAVAILABLE" });
  }

  private responseError(
    response: RaftlineHttpResponse,
    code: RaftlineErrorCode,
    ambiguous: boolean,
  ): RaftlineError {
    return new RaftlineError(`Raftline returned HTTP ${response.status}`, {
      code,
      status: response.status,
      ambiguous,
    });
  }
}

export function parseAccount(raw: string): RaftlineAccount {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RaftlineError("Raftline returned an invalid account response", {
      code: "BAD_RESPONSE",
    });
  }

  const parsed = rawAccountSchema.safeParse(value);
  if (!parsed.success) {
    throw new RaftlineError("Raftline account response has an unexpected shape", {
      code: "BAD_RESPONSE",
    });
  }

  const account = parsed.data;
  return {
    ...account,
    availableBalanceCents:
      account.availableBalanceCents ?? account.balanceCents - account.reservedCents,
  };
}

function isLeaderRedirect(response: RaftlineHttpResponse): boolean {
  return response.status === 307 || response.status === 308;
}

function isNotLeaderBody(response: RaftlineHttpResponse): boolean {
  if (response.status < 400) return false;
  return (
    response.text.includes("NotLeaderException") ||
    response.text.includes("Node is not the leader") ||
    response.text.includes("not the leader")
  );
}

function readLeaderHint(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.leaderHint === "string"
      ? parsed.leaderHint
      : typeof parsed.leaderId === "string"
        ? parsed.leaderId
        : null;
  } catch {
    return null;
  }
}

function leaderRedirectError(response: RaftlineHttpResponse): RaftlineError {
  return new RaftlineError("Raftline redirected the request to the leader", {
    code: "NOT_LEADER",
    status: response.status,
    leaderHint: readLeaderHint(response.text),
  });
}
