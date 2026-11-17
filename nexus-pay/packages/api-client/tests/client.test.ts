import { describe, expect, it } from "vitest";
import {
  LeaderLocator,
  RaftlineError,
  RaftlinePaymentsClient,
  parseAccount,
  type HttpTransport,
  type RaftlineConfig,
  type RaftlineHttpResponse,
} from "../src/index";

const config: RaftlineConfig = {
  baseUrls: ["http://node-a.test", "http://node-b.test"],
  tenantId: "nexuspay-test",
  apiKey: null,
  timeoutMs: 1000,
  leaderCacheTtlMs: 1000,
  accountCreateMode: "auto",
};

function response(status: number, body: unknown): RaftlineHttpResponse {
  return {
    status,
    headers: new Headers(),
    text: typeof body === "string" ? body : JSON.stringify(body),
    url: "http://node.test",
  };
}

function accountJson(accountId: string, currency = "INR") {
  return {
    accountId,
    tenantId: "nexuspay-test",
    currency,
    balanceCents: 0,
    reservedCents: 0,
    availableBalanceCents: 0,
    status: "ACTIVE",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    metadata: {},
  };
}

class FakeHttp implements HttpTransport {
  account: ReturnType<typeof accountJson> | null = null;
  officialCreateCount = 0;
  kvPutCount = 0;
  lastKvHeaders: Headers | null = null;
  lastKvKey: string | null = null;

  constructor(
    private readonly roles: Record<string, { nodeId: string; role: string; leaderId: string | null }>,
    private readonly officialCreateDrops = true,
  ) {}

  async request(url: string, init: RequestInit = {}): Promise<RaftlineHttpResponse> {
    const parsed = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();

    if (parsed.pathname === "/v1/cluster/status") {
      const role = this.roles[parsed.origin];
      if (!role) return response(503, { error: "down" });
      return response(200, { ...role, term: 1, commitIndex: 1, lastApplied: 1, lastLogIndex: 1, lastLogTerm: 1 });
    }

    if (parsed.pathname === "/v1/payments/accounts" && method === "POST") {
      this.officialCreateCount += 1;
      const body = JSON.parse(String(init.body)) as { accountId: string; currency: string };
      if (!this.officialCreateDrops) {
        this.account = accountJson(body.accountId, body.currency);
      }
      return response(201, accountJson(body.accountId, body.currency));
    }

    if (parsed.pathname === "/v1/payments/account" && method === "GET") {
      if (!this.account) return response(404, { error: "Account not found" });
      return response(200, this.account);
    }

    if (parsed.pathname.startsWith("/v1/kv/") && method === "PUT") {
      this.kvPutCount += 1;
      this.lastKvHeaders = new Headers(init.headers);
      this.lastKvKey = parsed.pathname;
      this.account = JSON.parse(String(init.body));
      return response(200, { status: "COMMITTED", key: "pay:acc", duplicate: false });
    }

    return response(404, { error: `Unhandled ${method} ${parsed.pathname}` });
  }
}

function buildClient(http: FakeHttp, mode: RaftlineConfig["accountCreateMode"] = "auto") {
  const currentConfig = { ...config, accountCreateMode: mode };
  const leader = new LeaderLocator(currentConfig.baseUrls, http, currentConfig.leaderCacheTtlMs);
  return new RaftlinePaymentsClient(currentConfig, http, leader);
}

describe("parseAccount", () => {
  it("computes available balance when it is absent", () => {
    const parsed = parseAccount(
      JSON.stringify({
        ...accountJson("np_test"),
        reservedCents: 250,
        availableBalanceCents: undefined,
      }),
    );
    expect(parsed.availableBalanceCents).toBe(-250);
  });

  it("rejects malformed account payloads", () => {
    expect(() => parseAccount(JSON.stringify({ accountId: "np_test" }))).toThrow(RaftlineError);
  });
});

describe("LeaderLocator", () => {
  it("finds a leader by node id when no probed node reports LEADER", async () => {
    const http = new FakeHttp({
      "http://node-a.test": { nodeId: "node-a", role: "FOLLOWER", leaderId: "node-b" },
      "http://node-b.test": { nodeId: "node-b", role: "FOLLOWER", leaderId: "node-b" },
    });
    const locator = new LeaderLocator(config.baseUrls, http, 1000);
    const leader = await locator.locate();
    expect(leader.nodeId).toBe("node-b");
    expect(leader.baseUrl).toBe("http://node-b.test");
  });

  it("throws when no node is reachable", async () => {
    const http = new FakeHttp({});
    const locator = new LeaderLocator(config.baseUrls, http, 1000);
    await expect(locator.locate()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("RaftlinePaymentsClient.ensureAccount", () => {
  it("falls back to the generic KV path and verifies the account when official create silently drops", async () => {
    const http = new FakeHttp(
      {
        "http://node-a.test": { nodeId: "node-a", role: "LEADER", leaderId: "node-a" },
        "http://node-b.test": { nodeId: "node-b", role: "FOLLOWER", leaderId: "node-a" },
      },
      true,
    );
    const client = buildClient(http, "auto");

    const result = await client.ensureAccount({
      accountId: "np_fallback",
      currency: "INR",
      metadata: { source: "test" },
    });

    expect(result.mode).toBe("kv");
    expect(result.created).toBe(true);
    expect(http.officialCreateCount).toBe(1);
    expect(http.kvPutCount).toBe(1);
    expect(http.lastKvHeaders?.get("X-Client-Id")).toMatch(/^nexuspay-provision-/);
    expect(http.lastKvHeaders?.get("X-Sequence-Number")).toBe("1");
    expect(http.lastKvKey).toContain("pay%3Aacc%3Anexuspay-test%3Anp_fallback");
  });

  it("does not create or overwrite an existing account", async () => {
    const http = new FakeHttp({
      "http://node-a.test": { nodeId: "node-a", role: "LEADER", leaderId: "node-a" },
    });
    http.account = accountJson("np_existing");

    const client = buildClient(http);
    const result = await client.ensureAccount({ accountId: "np_existing", currency: "INR" });

    expect(result.mode).toBe("existing");
    expect(result.created).toBe(false);
    expect(http.officialCreateCount).toBe(0);
    expect(http.kvPutCount).toBe(0);
  });

  it("fails without falling back in official-only mode", async () => {
    const http = new FakeHttp(
      {
        "http://node-a.test": { nodeId: "node-a", role: "LEADER", leaderId: "node-a" },
      },
      true,
    );
    const client = buildClient(http, "official");

    await expect(
      client.ensureAccount({ accountId: "np_official", currency: "INR" }),
    ).rejects.toMatchObject({ code: "PROVISIONING_FAILED", ambiguous: true });
    expect(http.kvPutCount).toBe(0);
  });

  it("rejects a currency mismatch instead of adopting the wrong account", async () => {
    const http = new FakeHttp({
      "http://node-a.test": { nodeId: "node-a", role: "LEADER", leaderId: "node-a" },
    });
    http.account = accountJson("np_currency", "USD");

    const client = buildClient(http);
    await expect(
      client.ensureAccount({ accountId: "np_currency", currency: "INR" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
