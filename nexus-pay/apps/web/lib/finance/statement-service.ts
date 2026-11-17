import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma, type Statement } from "@nexus/database";
import type {
  StatementCategorySummary,
  StatementTotals,
  StatementView,
} from "@nexus/shared-types";
import type { StatementGenerateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { createNotification } from "@/lib/social/shared";
import { resolveTransactionCategory } from "@/lib/finance/category-service";
import { SPENDING_CATEGORY_TYPES } from "@/lib/finance/analytics-service";

const statementsDir = path.resolve(process.cwd(), "apps/web/.statements");

async function statementFile(userId: string, statement: Statement): Promise<string> {
  const dir = path.join(statementsDir, userId);
  await mkdir(dir, { recursive: true });
  return path.join(dir, `${statement.id}.${statement.format.toLowerCase()}`);
}

async function loadStatementRows(userId: string, start: Date, end: Date) {
  return prisma.transactionRecord.findMany({
    where: {
      userId,
      status: "SUCCESSFUL",
      kind: "P2P",
      paymentRef: { not: null },
      occurredAt: { gte: start, lte: end },
    },
    orderBy: { occurredAt: "asc" },
    take: 5_000,
  });
}

async function computeTotals(userId: string, start: Date, end: Date): Promise<StatementTotals> {
  const rows = await loadStatementRows(userId, start, end);
  const inflow = rows.filter((row) => row.direction === "RECEIVED").reduce((sum, row) => sum + Number(row.amountMinor), 0);
  const outflow = rows.filter((row) => row.direction === "SENT").reduce((sum, row) => sum + Number(row.amountMinor), 0);

  const categorizations = await prisma.transactionCategorization.findMany({
    where: { userId, paymentRef: { in: rows.map((row) => row.paymentRef!) } },
    include: { category: true },
  });
  const categoryByRef = new Map(categorizations.map((row) => [row.paymentRef, row.category]));

  const categoryMap = new Map<string, StatementCategorySummary>();
  for (const row of rows) {
    if (row.direction !== "SENT") continue;
    const category = categoryByRef.get(row.paymentRef!);
    const id = category?.id ?? "uncategorized";
    const name = category?.name ?? "Uncategorized";
    const entry = categoryMap.get(id) ?? { categoryId: id, categoryName: name, amountMinor: 0, transactionCount: 0 };
    entry.amountMinor += Number(row.amountMinor);
    entry.transactionCount += 1;
    categoryMap.set(id, entry);
  }

  // Reconstruct opening/closing balances from verified transaction receipts.
  const beforePeriod = await prisma.transactionRecord.findFirst({
    where: { userId, status: "SUCCESSFUL", kind: "P2P", paymentRef: { not: null }, occurredAt: { lt: start } },
    orderBy: { occurredAt: "desc" },
    select: { balanceAfterMinor: true },
  });
  const lastInRange = rows[rows.length - 1];
  let closing = lastInRange?.balanceAfterMinor ?? null;
  let closingAvailable = closing !== null && closing !== undefined;
  if (closing === null || closing === undefined) {
    const overview = await getWalletOverviewForUser(userId).catch(() => null);
    if (overview?.balance) {
      closing = BigInt(overview.balance.availableMinor);
      closingAvailable = true;
    }
  }

  return {
    inflowMinor: inflow,
    outflowMinor: outflow,
    netMinor: inflow - outflow,
    transactionCount: rows.length,
    openingBalanceMinor: beforePeriod?.balanceAfterMinor != null ? Number(beforePeriod.balanceAfterMinor) : null,
    closingBalanceMinor: closing === null || closing === undefined ? null : Number(closing),
    openingBalanceAvailable: beforePeriod?.balanceAfterMinor != null,
    closingBalanceAvailable: closingAvailable,
    categories: [...categoryMap.values()].sort((a, b) => b.amountMinor - a.amountMinor),
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function buildCsv(
  rows: Awaited<ReturnType<typeof loadStatementRows>>,
  totals: StatementTotals,
  start: Date,
  end: Date,
): string {
  const lines = [
    "Nexus Pay statement",
    `Period,${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    `Total inflow (INR),${(totals.inflowMinor / 100).toFixed(2)}`,
    `Total outflow (INR),${(totals.outflowMinor / 100).toFixed(2)}`,
    `Net cash flow (INR),${(totals.netMinor / 100).toFixed(2)}`,
    `Transactions,${totals.transactionCount}`,
    "",
    "Date,Direction,Counterparty,Description,Amount (INR),Reference",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.occurredAt.toISOString(),
        row.direction,
        csvEscape(row.counterpartyName ?? "Nexus Pay customer"),
        csvEscape(row.description ?? ""),
        (Number(row.amountMinor) / 100).toFixed(2),
        csvEscape(row.paymentRef ?? ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

async function buildPdf(
  rows: Awaited<ReturnType<typeof loadStatementRows>>,
  totals: StatementTotals,
  start: Date,
  end: Date,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const margin = 48;
  let y = 800;

  page.drawText("NEXUS PAY", { x: margin, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 32;
  page.drawText("Financial statement", { x: margin, y, size: 24, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 24;
  page.drawText(
    `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    { x: margin, y, size: 11, font, color: rgb(0.35, 0.38, 0.45) },
  );
  y -= 30;

  // Standard PDF fonts cannot encode the ₹ glyph, so PDF statements use the
  // explicit "INR" prefix. CSV retains full Unicode.
  const inr = (minor: number) => `INR ${(minor / 100).toFixed(2)}`;
  const summary: Array<[string, string]> = [
    ["Total inflow", inr(totals.inflowMinor)],
    ["Total outflow", inr(totals.outflowMinor)],
    ["Net cash flow", inr(totals.netMinor)],
    ["Transactions", String(totals.transactionCount)],
    [
      "Opening balance",
      totals.openingBalanceAvailable ? inr(totals.openingBalanceMinor ?? 0) : "Not available",
    ],
    [
      "Closing balance",
      totals.closingBalanceAvailable ? inr(totals.closingBalanceMinor ?? 0) : "Not available",
    ],
  ];
  for (const [label, value] of summary) {
    page.drawText(label, { x: margin, y, size: 10, font, color: rgb(0.35, 0.38, 0.45) });
    page.drawText(value, { x: 260, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16) });
    y -= 16;
  }

  y -= 16;
  page.drawText("Transactions", { x: margin, y, size: 13, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 18;
  for (const row of rows.slice(0, 60)) {
    if (y < 70) break;
    const label = `${row.occurredAt.toISOString().slice(0, 10)}  ${row.direction}  ${row.counterpartyName ?? "Nexus Pay customer"}`;
    page.drawText(label.slice(0, 62), { x: margin, y, size: 8, font, color: rgb(0.2, 0.23, 0.3) });
    page.drawText(`${(Number(row.amountMinor) / 100).toFixed(2)}`, { x: 470, y, size: 8, font: bold, color: rgb(0.06, 0.09, 0.16) });
    y -= 12;
  }
  if (rows.length > 60) {
    page.drawText(`+ ${rows.length - 60} more transactions (see CSV export)`, { x: margin, y, size: 8, font, color: rgb(0.35, 0.38, 0.45) });
  }

  return pdf.save();
}

function toView(statement: Statement, totals: StatementTotals): StatementView {
  return {
    id: statement.id,
    periodStart: statement.periodStart.toISOString(),
    periodEnd: statement.periodEnd.toISOString(),
    format: statement.format,
    status: statement.status,
    fileSize: statement.fileSize,
    createdAt: statement.createdAt.toISOString(),
    totals,
  };
}

export async function generateStatement(userId: string, input: StatementGenerateInput): Promise<StatementView> {
  const start = new Date(`${input.periodStart}T00:00:00.000Z`);
  const end = new Date(`${input.periodEnd}T23:59:59.999Z`);
  const statement = await prisma.statement.create({
    data: {
      userId,
      periodStart: start,
      periodEnd: end,
      format: input.format,
      status: "GENERATING",
    },
  });

  try {
    const totals = await computeTotals(userId, start, end);
    const rows = await loadStatementRows(userId, start, end);
    const content =
      input.format === "CSV" ? buildCsv(rows, totals, start, end) : await buildPdf(rows, totals, start, end);
    const filePath = await statementFile(userId, statement);
    await writeFile(filePath, content);
    const size = content instanceof Uint8Array ? content.byteLength : Buffer.byteLength(content, "utf8");

    const ready = await prisma.statement.update({
      where: { id: statement.id },
      data: { status: "READY", fileName: `${statement.id}.${input.format.toLowerCase()}`, fileSize: size },
    });
    await createNotification(prisma, {
      userId,
      type: "STATEMENT_AVAILABLE",
      title: "Your statement is ready",
      body: `${input.format} statement for ${input.periodStart} to ${input.periodEnd}.`,
      data: { statementId: statement.id },
    });
    return toView(ready, totals);
  } catch (error) {
    await prisma.statement.update({ where: { id: statement.id }, data: { status: "FAILED" } });
    throw error;
  }
}

export async function listStatements(userId: string): Promise<StatementView[]> {
  const statements = await prisma.statement.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const views: StatementView[] = [];
  for (const statement of statements) {
    const totals = await computeTotals(
      userId,
      new Date(statement.periodStart),
      new Date(statement.periodEnd),
    );
    views.push(toView(statement, totals));
  }
  return views;
}

export async function getStatement(userId: string, statementId: string): Promise<StatementView> {
  const statement = await prisma.statement.findFirst({ where: { id: statementId, userId } });
  if (!statement) throw new ApiError(404, "AUTHORIZATION_ERROR", "That statement could not be found.");
  const totals = await computeTotals(userId, new Date(statement.periodStart), new Date(statement.periodEnd));
  return toView(statement, totals);
}

export async function downloadStatement(
  userId: string,
  statementId: string,
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const statement = await prisma.statement.findFirst({ where: { id: statementId, userId } });
  if (!statement) throw new ApiError(404, "AUTHORIZATION_ERROR", "That statement could not be found.");
  if (statement.status !== "READY" || !statement.fileName) {
    throw new ApiError(409, "PAYMENT_ERROR", "This statement is not ready for download yet.");
  }
  const filePath = await statementFile(userId, statement);
  const buffer = await readFile(filePath);
  return {
    buffer,
    fileName: statement.fileName,
    contentType: statement.format === "CSV" ? "text/csv; charset=utf-8" : "application/pdf",
  };
}

/** Used by analytics/category listing so category names stay consistent. */
export async function categoryNameForTransaction(userId: string, paymentRef: string): Promise<string> {
  const categoryId = await resolveTransactionCategory(userId, paymentRef, null);
  const category = await prisma.transactionCategory.findUnique({ where: { id: categoryId } });
  return category?.name ?? "Uncategorized";
}

export { SPENDING_CATEGORY_TYPES };
