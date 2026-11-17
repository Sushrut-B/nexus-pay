import path from "node:path";
import dotenv from "dotenv";
import { prisma } from "../../packages/database/src/index";

dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local") });

const E2E_EMAIL_DOMAIN = "@example.test";

export default async function globalTeardown() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "e2e.", endsWith: E2E_EMAIL_DOMAIN } },
    include: { wallets: true },
  });

  if (users.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const userIds = users.map((user) => user.id);
  const walletIds = users.flatMap((user) => user.wallets.map((wallet) => wallet.id));
  const accountIds = [
    ...new Set(
      users.flatMap((user) =>
        user.wallets.map(
          (wallet) =>
            wallet.raftlineAccountId ?? `np_${user.id}_${wallet.currency.toLowerCase()}`,
        ),
      ),
    ),
  ];

  if (accountIds.length > 0) {
    await deleteRaftlineAccounts(accountIds).catch((error: unknown) => {
      console.warn(`E2E cleanup: Raftline cleanup skipped: ${String(error)}`);
    });
  }

  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { entityId: { in: [...userIds, ...walletIds] } },
      ],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  console.log(`E2E cleanup: removed ${users.length} test user(s) and ${accountIds.length} ledger account(s).`);
  await prisma.$disconnect();
}

async function deleteRaftlineAccounts(accountIds: string[]): Promise<void> {
  const tenantId = process.env.RAFTLINE_TENANT_ID ?? "nexuspay";
  const baseUrls = [1, 2, 3, 4, 5].map((index) => `http://localhost:800${index}`);
  let leaderUrl: string | null = null;

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/v1/cluster/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) continue;
      const status = (await response.json()) as { role?: string; nodeId?: string };
      if (status.role === "LEADER") {
        leaderUrl = baseUrl;
        break;
      }
    } catch {
      // Try the next node.
    }
  }

  if (!leaderUrl) return;

  for (const accountId of accountIds) {
    const key = encodeURIComponent(`pay:acc:${tenantId}:${accountId}`);
    await fetch(`${leaderUrl}/v1/kv/${key}`, {
      method: "DELETE",
      headers: {
        "X-Client-Id": `e2e-cleanup-${accountId}`,
        "X-Sequence-Number": "1",
      },
    });
  }
}
