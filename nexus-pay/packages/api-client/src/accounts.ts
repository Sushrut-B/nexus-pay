import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSafeAccountId, type RaftlineConfig } from "./config";
import { RaftlineError, isNotLeaderError } from "./errors";
import type { HttpTransport, RaftlineHttpResponse } from "./http";
import type { LeaderLocator } from "./leader";

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

  private async leaderRequest(path: string, init: RequestInit): Promise<LeaderResponse> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_LEADER_ATTEMPTS; attempt += 1) {
      const location = await this.leader.locate(attempt > 0);
      const response = await this.http.request(`${location.baseUrl}${path}`, init);

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
    code: "UNAVAILABLE" | "AMBIGUOUS" | "PROVISIONING_FAILED",
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
