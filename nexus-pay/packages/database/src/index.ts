import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  nexusPayPrisma?: PrismaClient;
};

/**
 * A single Prisma client per process. Query parameter logging is deliberately
 * disabled: it can contain password hashes and session token hashes.
 */
export const prisma =
  globalForPrisma.nexusPayPrisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.nexusPayPrisma = prisma;
}

export { Prisma } from "@prisma/client";
export type {
  AccountStatus,
  AuditEvent,
  Contact,
  Expense,
  ExpenseCategory,
  ExpenseGroup,
  ExpenseSplit,
  FundingOperation,
  FundingOperationStatus,
  GroupActivity,
  GroupActivityEventType,
  GroupCategory,
  GroupMember,
  GroupRole,
  GroupSettlement,
  Notification,
  NotificationType,
  PasswordResetToken,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentRequest,
  PaymentRequestStatus,
  SettlementStatus,
  SplitMethod,
  TransactionDirection,
  TransactionKind,
  TransactionRecord,
  TransactionStatus,
  User,
  UserProfile,
  UserSession,
  Wallet,
  WalletStatus,
  WalletType,
} from "@prisma/client";
