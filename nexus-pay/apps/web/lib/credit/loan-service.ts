import { prisma } from "@nexus/database";
import type { LoanView, RepaymentView, BorrowingOverviewView } from "@nexus/shared-types";
import type { LenderRepaymentRow } from "@/lib/credit/lender-adapter";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";

export function loanView(row: {
  id: string; userId: string; providerLoanRef: string; originalPrincipalMinor: number;
  outstandingPrincipalMinor: number; interestRateBps: number; aprBps: number | null;
  tenureMonths: number; emiMinor: number; nextDueDate: Date | null; totalRepaidMinor: number;
  totalRemainingMinor: number; status: string; providerReportedAt: Date; provider: { displayName: string; mode: string };
}): LoanView {
  return {
    id: row.id,
    userId: row.userId,
    lender: row.provider.displayName,
    loanRef: row.providerLoanRef,
    originalPrincipalMinor: row.originalPrincipalMinor,
    outstandingPrincipalMinor: row.outstandingPrincipalMinor,
    interestRateBps: row.interestRateBps,
    aprBps: row.aprBps,
    tenureMonths: row.tenureMonths,
    emiMinor: row.emiMinor,
    nextDueDate: row.nextDueDate?.toISOString() ?? null,
    totalRepaidMinor: row.totalRepaidMinor,
    totalRemainingMinor: row.totalRemainingMinor,
    status: row.status,
    providerReportedAt: row.providerReportedAt.toISOString(),
    isSandbox: row.provider.mode === "SANDBOX",
  };
}

export async function listLoans(userId: string): Promise<LoanView[]> {
  const rows = await prisma.activeLoan.findMany({
    where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map(loanView);
}

export async function getLoan(userId: string, id: string): Promise<LoanView> {
  const row = await prisma.activeLoan.findFirst({ where: { id, userId }, include: { provider: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan not found.");
  return loanView(row);
}

export function repaymentView(row: {
  id: string; installmentNo: number; dueDate: Date; principalMinor: number; interestMinor: number;
  feesMinor: number; totalMinor: number; status: string; paymentRef: string | null;
}): RepaymentView {
  return {
    id: row.id, installmentNo: row.installmentNo, dueDate: row.dueDate.toISOString(),
    principalMinor: row.principalMinor, interestMinor: row.interestMinor, feesMinor: row.feesMinor,
    totalMinor: row.totalMinor, status: row.status as RepaymentView["status"],
    paymentRef: row.paymentRef, isProviderReported: true,
  };
}

export async function getSchedule(userId: string, loanId: string): Promise<RepaymentView[]> {
  await getLoan(userId, loanId);
  const rows = await prisma.loanRepaymentSchedule.findMany({
    where: { loanId }, orderBy: { installmentNo: "asc" }, take: 500,
  });
  return rows.map(repaymentView);
}

export async function getRepayments(userId: string, loanId: string): Promise<RepaymentView[]> {
  await getLoan(userId, loanId);
  const rows = await prisma.loanRepayment.findMany({ where: { loanId }, orderBy: { paidAt: "desc" }, take: 200 });
  return rows.map((row) => ({
    id: row.id, installmentNo: 0, dueDate: row.paidAt.toISOString(), principalMinor: 0,
    interestMinor: 0, feesMinor: 0, totalMinor: row.amountMinor,
    status: row.status as RepaymentView["status"], paymentRef: row.paymentRef, isProviderReported: true,
  }));
}

/** Create an ActiveLoan only from a verified provider disbursement event. */
export async function activateLoanFromProvider(input: {
  userId: string;
  applicationId: string;
  providerId: string;
  providerLoanRef: string;
  principalMinor: number;
  interestRateBps: number;
  aprBps?: number;
  tenureMonths: number;
  emiMinor: number;
  evidence: string;
}): Promise<string> {
  const existing = await prisma.activeLoan.findFirst({ where: { providerLoanRef: input.providerLoanRef } });
  if (existing) return existing.id;
  const loan = await prisma.$transaction(async (tx) => {
    const row = await tx.activeLoan.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId,
        providerId: input.providerId,
        providerLoanRef: input.providerLoanRef,
        originalPrincipalMinor: input.principalMinor,
        outstandingPrincipalMinor: input.principalMinor,
        interestRateBps: input.interestRateBps,
        aprBps: input.aprBps ?? null,
        tenureMonths: input.tenureMonths,
        emiMinor: input.emiMinor,
        totalRemainingMinor: input.principalMinor,
        status: "ACTIVE",
        providerReportedAt: new Date(),
      },
    });
    await tx.loanServicingEvent.create({
      data: {
        providerId: input.providerId, applicationId: input.applicationId, loanId: row.id,
        eventType: "LOAN_DISBURSED", payload: { evidence: input.evidence }, providerRef: input.evidence,
      },
    });
    return row;
  });
  await createNotification(prisma, {
    userId: input.userId, type: "CREDIT_LOAN_DISBURSED",
    title: "Loan disbursement confirmed", body: "The lender has confirmed disbursement of your loan.",
    data: { loanId: loan.id },
  });
  return loan.id;
}

export async function importProviderSchedule(loanId: string, rows: LenderRepaymentRow[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await prisma.loanRepaymentSchedule.upsert({
      where: { loanId_providerRef: { loanId, providerRef: row.providerRef } },
      create: {
        loanId,
        installmentNo: row.installmentNo,
        dueDate: row.dueDate,
        principalMinor: row.principalMinor,
        interestMinor: row.interestMinor,
        feesMinor: row.feesMinor,
        totalMinor: row.totalMinor,
        status: "UPCOMING",
        providerRef: row.providerRef,
      },
      update: {
        dueDate: row.dueDate, principalMinor: row.principalMinor, interestMinor: row.interestMinor,
        feesMinor: row.feesMinor, totalMinor: row.totalMinor,
      },
    });
    count += 1;
  }
  return count;
}

/** Verified repayment confirmation updates exactly once (unique providerRef). */
export async function confirmProviderRepayment(input: {
  loanId: string; providerRef: string; amountMinor: number; paidAt: Date; evidence: string;
}): Promise<boolean> {
  const existing = await prisma.loanRepayment.findUnique({ where: { providerRef: input.providerRef } });
  if (existing) return false;
  await prisma.$transaction(async (tx) => {
    await tx.loanRepayment.create({
      data: {
        loanId: input.loanId, providerRef: input.providerRef, amountMinor: input.amountMinor,
        paidAt: input.paidAt, paymentRef: input.evidence, status: "PAID",
      },
    });
    const loan = await tx.activeLoan.findUniqueOrThrow({ where: { id: input.loanId } });
    await tx.activeLoan.update({
      where: { id: loan.id },
      data: {
        totalRepaidMinor: { increment: input.amountMinor },
        outstandingPrincipalMinor: { decrement: Math.min(input.amountMinor, loan.outstandingPrincipalMinor) },
        totalRemainingMinor: { decrement: Math.min(input.amountMinor, loan.totalRemainingMinor) },
      },
    });
    await tx.loanServicingEvent.create({
      data: {
        providerId: loan.providerId, loanId: loan.id, eventType: "REPAYMENT_CONFIRMED",
        payload: { amountMinor: input.amountMinor, evidence: input.evidence }, providerRef: input.providerRef,
      },
    });
  });
  await createNotification(prisma, {
    userId: (await prisma.activeLoan.findUniqueOrThrow({ where: { id: input.loanId } })).userId,
    type: "CREDIT_REPAYMENT_CONFIRMED", title: "Repayment confirmed",
    body: "The lender confirmed your repayment.", data: { loanId: input.loanId },
  });
  return true;
}

export async function getBorrowingOverview(userId: string): Promise<BorrowingOverviewView> {
  const [loans, applications] = await Promise.all([
    prisma.activeLoan.findMany({ where: { userId } }),
    prisma.loanApplication.count({ where: { userId } }),
  ]);
  const active = loans.filter((loan) => loan.status === "ACTIVE");
  const outstanding = active.reduce((sum, loan) => sum + loan.outstandingPrincipalMinor, 0);
  const monthly = active.reduce((sum, loan) => sum + loan.emiMinor, 0);
  const upcoming = active
    .filter((loan) => loan.nextDueDate && loan.nextDueDate.getTime() <= Date.now() + 30 * 86_400_000)
    .reduce((sum, loan) => sum + loan.emiMinor, 0);
  await prisma.borrowingOverviewSnapshot.upsert({
    where: { userId },
    create: {
      userId, activeLoans: active.length, outstandingMinor: outstanding,
      monthlyCommitmentMinor: monthly, upcomingMinor: upcoming,
      completedLoans: loans.filter((loan) => loan.status === "CLOSED").length,
      payload: { currency: "INR" },
    },
    update: {
      activeLoans: active.length, outstandingMinor: outstanding,
      monthlyCommitmentMinor: monthly, upcomingMinor: upcoming,
    },
  });
  return {
    activeLoans: active.length,
    outstandingMinor: outstanding,
    monthlyCommitmentMinor: monthly,
    upcomingMinor: upcoming,
    completedLoans: loans.filter((loan) => loan.status === "CLOSED").length,
    applicationCount: applications,
    currency: "INR",
    notice: "Provider-reported loan data. Nexus Pay is not a lender and does not provide an official credit score.",
  };
}
