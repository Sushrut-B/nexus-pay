import { prisma } from "@nexus/database";

const LOCK_NAMESPACE = "nexuspay:ledger:";

/**
 * Serialises app-originated ledger writes that touch the same Raftline account.
 *
 * Raftline currently applies account changes with a read-modify-write cycle, so
 * two concurrent operations on the same account can lose an update. The
 * consensus log makes every accepted write durable, but it does not serialise
 * the application-level read that produced the write. This PostgreSQL advisory
 * lock closes that gap for operations started by Nexus Pay.
 *
 * This is an application safeguard, not a consensus guarantee: another
 * application writing to the same Raftline tenant must apply equivalent
 * serialisation. Locks are always acquired in sorted key order so two transfers
 * in opposite directions cannot deadlock. The lock is transaction-scoped and
 * released automatically as soon as the ledger call finishes.
 */
export async function withLedgerAccountLocks<T>(
  accountIds: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(accountIds.filter((value) => value.trim().length > 0))].sort();
  if (keys.length === 0) return operation();

  return prisma.$transaction(
    async (tx) => {
      for (const key of keys) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${LOCK_NAMESPACE}${key}`}))`;
      }
      return operation();
    },
    { maxWait: 10_000, timeout: 70_000 },
  );
}
