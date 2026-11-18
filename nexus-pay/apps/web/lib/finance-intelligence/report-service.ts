import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@nexus/database";
import type { FinancialReportView } from "@nexus/shared-types";
import type { FinancialReportCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { resolveFinancePeriod } from "@/lib/finance-intelligence/aggregation-service";
import { getCashFlow, getCategorySpend, getMerchantSpend } from "@/lib/finance-intelligence/aggregation-service";
import { getSubscriptionIntelligence } from "@/lib/finance-intelligence/subscription-intelligence-service";
import { getExtendedOverview } from "@/lib/finance-intelligence/aggregation-service";
import { listFinancialGoals } from "@/lib/finance-intelligence/goals-service";
import { listPatterns } from "@/lib/finance-intelligence/recurring-service";

const REPORT_DIR = path.join(process.cwd(), ".reports");

function view(row: {
  id: string; type: string; format: string; periodStart: Date; periodEnd: Date; status: string;
  fileName: string | null; error: string | null; createdAt: Date; completedAt: Date | null;
}): FinancialReportView {
  return {
    id: row.id, type: row.type, format: row.format,
    periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
    status: row.status, fileName: row.fileName, error: row.error,
    createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function createReport(userId: string, input: FinancialReportCreateInput): Promise<FinancialReportView> {
  const window = resolveFinancePeriod(input.period, input.from, input.to);
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.financialReport.create({
      data: {
        userId, type: input.type, format: input.format,
        periodStart: window.from, periodEnd: window.to, status: "PENDING",
      },
    });
    await tx.financialReportJob.create({ data: { reportId: created.id, status: "PENDING" } });
    return created;
  });
  return view(report);
}

export async function listReports(userId: string): Promise<FinancialReportView[]> {
  const rows = await prisma.financialReport.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(view);
}

interface ReportLine {
  label: string;
  value: string;
}

async function buildReportData(userId: string, report: { type: string; periodStart: Date; periodEnd: Date }): Promise<{ lines: ReportLine[]; definitions: string[] }> {
  const period = "custom" as const;
  const from = report.periodStart.toISOString().slice(0, 10);
  const to = report.periodEnd.toISOString().slice(0, 10);
  const cashFlow = await getCashFlow(userId, period, from, to);
  const lines: ReportLine[] = [
    { label: "Total inflow", value: (cashFlow.totalInflowMinor / 100).toFixed(2) },
    { label: "Total outflow", value: (cashFlow.totalOutflowMinor / 100).toFixed(2) },
    { label: "Net cash flow", value: (cashFlow.netMinor / 100).toFixed(2) },
  ];
  const definitions = Object.values(cashFlow.definitions);

  if (report.type === "CATEGORY_EXPENDITURE") {
    const categories = await getCategorySpend(userId, period, from, to);
    lines.push(...categories.map((category) => ({ label: `Category: ${category.category}`, value: (category.amountMinor / 100).toFixed(2) })));
  } else if (report.type === "MERCHANT_EXPENDITURE") {
    const merchants = await getMerchantSpend(userId, period, from, to);
    lines.push(...merchants.map((merchant) => ({ label: `Merchant: ${merchant.merchant}`, value: (merchant.amountMinor / 100).toFixed(2) })));
  } else if (report.type === "SUBSCRIPTION") {
    const subscriptions = await getSubscriptionIntelligence(userId);
    lines.push(
      { label: "Monthly commitment", value: (subscriptions.monthlyCommitmentMinor / 100).toFixed(2) },
      { label: "Annual commitment (estimate)", value: (subscriptions.annualCommitmentMinor / 100).toFixed(2) },
      { label: "Settled renewals", value: (subscriptions.settledRenewalsMinor / 100).toFixed(2) },
    );
    definitions.push(subscriptions.notice);
  } else if (report.type === "RECURRING_PAYMENT") {
    const patterns = await listPatterns(userId);
    lines.push(...patterns.map((pattern) => ({ label: `Recurring: ${pattern.merchant}`, value: (pattern.amountMinor / 100).toFixed(2) })));
  } else if (report.type === "SAVINGS_GOAL") {
    const goals = await listFinancialGoals(userId);
    lines.push(...goals.map((goal) => ({ label: `Goal: ${goal.name}`, value: (goal.recordedMinor / 100).toFixed(2) })));
    definitions.push("Planned contributions are not real transfers and are excluded from recorded amounts.");
  } else if (report.type === "BUDGET_PERFORMANCE" || report.type === "MONTHLY_SUMMARY" || report.type === "ANNUAL_SUMMARY") {
    const overview = await getExtendedOverview(userId, period, from, to);
    lines.push(
      { label: "Wallet balance (Raftline)", value: (overview.walletBalanceMinor / 100).toFixed(2) },
      { label: "Savings estimate", value: (overview.savingsEstimateMinor / 100).toFixed(2) },
      { label: "Cashback credited", value: (overview.cashbackCreditedMinor / 100).toFixed(2) },
    );
    definitions.push(overview.notice);
  }
  return { lines, definitions };
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function render(content: { lines: ReportLine[]; definitions: string[] }, format: string, report: { type: string }) {
  if (format === "CSV") {
    const rows = [
      ["Metric", "Value (INR)"],
      ...content.lines.map((line) => [line.label, line.value]),
      [],
      ["Definition"],
      ...content.definitions.map((definition) => [definition]),
    ];
    return Buffer.from(rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const write = (text: string, size = 10) => {
    for (const part of text.match(/.{1,80}(\s|$)/g) ?? [text]) {
      page.drawText(part, { x: 48, y, size, font, color: rgb(0.06, 0.09, 0.16) });
      y -= size + 5;
    }
  };
  write(`Nexus Pay — ${report.type.replaceAll("_", " ")}`, 16);
  y -= 10;
  for (const line of content.lines) write(`${line.label}: ${line.value}`);
  y -= 10;
  write("Definitions", 12);
  for (const definition of content.definitions) write(`- ${definition}`, 8);
  return Buffer.from(await pdf.save());
}

/** Claim and generate one report. Idempotent and safe for multiple workers. */
export async function processReportJob(jobId: string): Promise<"generated" | "skipped"> {
  const job = await prisma.financialReportJob.findUnique({ where: { id: jobId }, include: { report: true } });
  if (!job || job.status !== "PENDING") return "skipped";
  const claimed = await prisma.financialReportJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 300_000) },
  });
  if (claimed.count === 0) return "skipped";
  try {
    const content = await buildReportData(job.report.userId, job.report);
    const buffer = await render(content, job.report.format, job.report);
    const fileName = `nexus-pay-${job.report.type.toLowerCase()}-${job.report.id}.${job.report.format.toLowerCase()}`;
    const dir = path.join(REPORT_DIR, job.report.userId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), buffer);
    await prisma.$transaction(async (tx) => {
      await tx.financialReport.update({
        where: { id: job.reportId },
        data: { status: "READY", fileName, fileSize: buffer.length, completedAt: new Date() },
      });
      await tx.financialReportJob.update({ where: { id: jobId }, data: { status: "DONE", leaseUntil: null } });
    });
    await prisma.notification.create({
      data: {
        userId: job.report.userId, type: "FINANCE_REPORT_READY",
        title: "Your report is ready", body: `${job.report.type.replaceAll("_", " ")} report is available to download.`,
        data: { reportId: job.reportId },
      },
    });
    return "generated";
  } catch (error) {
    const attempts = job.attempts + 1;
    const dead = attempts >= 3;
    await prisma.$transaction(async (tx) => {
      await tx.financialReport.update({
        where: { id: job.reportId },
        data: { status: dead ? "FAILED" : "PENDING", error: error instanceof Error ? error.message.slice(0, 500) : "Report generation failed" },
      });
      await tx.financialReportJob.update({
        where: { id: jobId },
        data: {
          status: dead ? "DEAD_LETTER" : "PENDING", leaseUntil: null,
          error: error instanceof Error ? error.message.slice(0, 500) : "Report generation failed",
          nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
        },
      });
    });
    return "generated";
  }
}

export async function runReportWorker(limit = 10): Promise<number> {
  const due = await prisma.financialReportJob.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    take: limit,
  });
  let processed = 0;
  for (const job of due) {
    await processReportJob(job.id);
    processed += 1;
  }
  return processed;
}

export async function downloadReport(userId: string, id: string): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const report = await prisma.financialReport.findFirst({ where: { id, userId } });
  if (!report) throw new ApiError(404, "AUTHORIZATION_ERROR", "Report not found.");
  if (report.status !== "READY" || !report.fileName) {
    throw new ApiError(409, "PAYMENT_ERROR", "This report is not ready for download.");
  }
  const buffer = await readFile(path.join(REPORT_DIR, report.userId, report.fileName));
  return {
    buffer,
    fileName: report.fileName,
    contentType: report.format === "CSV" ? "text/csv; charset=utf-8" : "application/pdf",
  };
}
