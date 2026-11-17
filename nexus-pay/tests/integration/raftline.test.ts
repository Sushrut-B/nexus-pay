import { afterAll, describe, expect, it } from "vitest";
import { createRaftlineClient, type RaftlineConfig } from "../../packages/api-client/src/index";

const enabled = process.env.RUN_RAFTLINE_INTEGRATION === "1";
const accountId = `np_it_${Date.now()}`;
const config: RaftlineConfig = {
  baseUrls: [1, 2, 3, 4, 5].map((n) => `http://localhost:800${n}`),
  tenantId: "nexuspay-test",
  apiKey: process.env.RAFTLINE_API_KEY?.trim() || null,
  timeoutMs: 8000,
  leaderCacheTtlMs: 2000,
  accountCreateMode: "auto",
};

const client = createRaftlineClient({ config });

async function deleteTestAccount(): Promise<void> {
  const summary = await client.getClusterSummary();
  if (!summary.leader) return;
  const key = encodeURIComponent(`pay:acc:${config.tenantId}:${accountId}`);
  await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
    method: "DELETE",
    headers: {
      "X-Client-Id": `nexuspay-it-cleanup-${Date.now()}`,
      "X-Sequence-Number": "1",
    },
  });
}

describe.skipIf(!enabled)("live Raftline account provisioning", () => {
  afterAll(async () => {
    await deleteTestAccount().catch(() => undefined);
  });

  it("discovers the current leader and provisions a verified account", async () => {
    const summary = await client.getClusterSummary();
    expect(summary.leader).not.toBeNull();
    expect(summary.statuses.length).toBeGreaterThan(0);

    const result = await client.ensureAccount({
      accountId,
      currency: "INR",
      metadata: { source: "integration-test" },
    });

    expect(result.created).toBe(true);
    expect(["official", "kv"]).toContain(result.mode);
    expect(result.account.accountId).toBe(accountId);
    expect(result.account.tenantId).toBe(config.tenantId);
    expect(result.account.availableBalanceCents).toBe(0);

    const readback = await client.getAccount(accountId);
    expect(readback?.accountId).toBe(accountId);

    const second = await client.ensureAccount({
      accountId,
      currency: "INR",
    });
    expect(second.created).toBe(false);
    expect(second.mode).toBe("existing");
  });

  it("returns null for a missing account", async () => {
    const missing = await client.getAccount(`np_missing_${Date.now()}`);
    expect(missing).toBeNull();
  });
});
