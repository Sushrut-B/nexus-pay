import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Prisma, prisma, type Invoice } from "@nexus/database";
import type { InvoiceView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

const invoiceInclude = { items: true } as const;

export function toInvoiceView(invoice: Invoice & { items: Array<{ description: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }> }): InvoiceView {
  return {
    id: invoice.id,
    merchantId: invoice.merchantId,
    subscriptionId: invoice.subscriptionId,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    subtotalMinor: invoice.subtotalMinor,
    taxMinor: invoice.taxMinor,
    discountMinor: invoice.discountMinor,
    setupFeeMinor: invoice.setupFeeMinor,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    paymentRef: invoice.paymentRef,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
    createdAt: invoice.createdAt.toISOString(),
  };
}

/** Atomic, merchant-scoped invoice numbering via an upsert counter. */
export async function nextInvoiceNumber(db: Prisma.TransactionClient | typeof prisma, merchantId: string, at = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  const sequence = await db.invoiceNumberSequence.upsert({
    where: { merchantId },
    create: { merchantId, year, nextValue: 2 },
    update: { nextValue: { increment: 1 }, year },
  });
  return `INV-${year}-${String(sequence.nextValue - 1).padStart(6, "0")}`;
}

export interface CreateInvoiceInput {
  merchantId: string;
  customerUserId: string;
  subscriptionId?: string;
  occurrenceId?: string;
  amountMinor: number;
  setupFeeMinor?: number;
  currency: string;
  description: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  customerName: string;
  customerEmail: string;
  status?: "DRAFT" | "OPEN";
}

export async function createInvoice(db: Prisma.TransactionClient | typeof prisma, input: CreateInvoiceInput): Promise<Invoice> {
  const invoiceNumber = await nextInvoiceNumber(db, input.merchantId);
  const setupFeeMinor = input.setupFeeMinor ?? 0;
  return db.invoice.create({
    data: {
      merchantId: input.merchantId,
      customerUserId: input.customerUserId,
      subscriptionId: input.subscriptionId ?? null,
      occurrenceId: input.occurrenceId ?? null,
      invoiceNumber,
      status: input.status ?? "OPEN",
      subtotalMinor: input.amountMinor,
      taxMinor: 0,
      discountMinor: 0,
      setupFeeMinor,
      totalMinor: input.amountMinor + setupFeeMinor,
      currency: input.currency,
      issueDate: new Date(),
      dueDate: input.dueDate,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      customerName: input.customerName.slice(0, 120),
      customerEmail: input.customerEmail.slice(0, 254),
      items: {
        create: [
          {
            description: input.description.slice(0, 200),
            quantity: 1,
            unitPriceMinor: input.amountMinor,
            lineTotalMinor: input.amountMinor,
          },
          ...(setupFeeMinor > 0
            ? [{ description: "Setup fee", quantity: 1, unitPriceMinor: setupFeeMinor, lineTotalMinor: setupFeeMinor }]
            : []),
        ],
      },
    },
  });
}

export async function listInvoicesForMerchant(userId: string, status?: string): Promise<InvoiceView[]> {
  const merchant = await requireMerchantForUser(userId);
  const invoices = await prisma.invoice.findMany({
    where: {
      merchantId: merchant.id,
      ...(status ? { status: status as Invoice["status"] } : {}),
    },
    include: invoiceInclude,
    orderBy: { issueDate: "desc" },
    take: 200,
  });
  return invoices.map(toInvoiceView);
}

export async function listInvoicesForCustomer(userId: string, subscriptionId?: string): Promise<InvoiceView[]> {
  const invoices = await prisma.invoice.findMany({
    where: { customerUserId: userId, ...(subscriptionId ? { subscriptionId } : {}) },
    include: invoiceInclude,
    orderBy: { issueDate: "desc" },
    take: 200,
  });
  return invoices.map(toInvoiceView);
}

export async function getInvoiceForUser(userId: string, invoiceId: string): Promise<InvoiceView> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, OR: [{ customerUserId: userId }, { merchant: { ownerUserId: userId } }] },
    include: invoiceInclude,
  });
  if (!invoice) throw new ApiError(404, "AUTHORIZATION_ERROR", "Invoice not found.");
  return toInvoiceView(invoice);
}

export async function voidInvoice(userId: string, invoiceId: string): Promise<InvoiceView> {
  const merchant = await requireMerchantForUser(userId);
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, merchantId: merchant.id } });
  if (!invoice) throw new ApiError(404, "AUTHORIZATION_ERROR", "Invoice not found.");
  if (!["DRAFT", "OPEN"].includes(invoice.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "Only unpaid invoices can be voided.");
  }
  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID", voidedAt: new Date() },
    include: invoiceInclude,
  });
  return toInvoiceView(updated);
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function wrap(text: string, max = 92): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Sandbox invoice PDF. No tax registration numbers or compliance claims. */
export async function generateInvoicePdf(userId: string, invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, OR: [{ customerUserId: userId }, { merchant: { ownerUserId: userId } }] },
    include: { items: true, merchant: true },
  });
  if (!invoice) throw new ApiError(404, "AUTHORIZATION_ERROR", "Invoice not found.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  let y = 790;
  const left = 48;

  const line = (text: string, size = 10, isBold = false, color = rgb(0.06, 0.09, 0.16)) => {
    page.drawText(text, { x: left, y, size, font: isBold ? bold : font, color });
    y -= size + 6;
  };

  line("Nexus Pay", 20, true);
  line("Sandbox subscription invoice", 10, false, rgb(0.45, 0.47, 0.52));
  y -= 12;
  line(invoice.merchant.businessName, 14, true);
  line(invoice.merchant.email);
  y -= 12;
  line(`Invoice ${invoice.invoiceNumber}`, 12, true);
  line(`Issue date: ${invoice.issueDate.toISOString().slice(0, 10)}`);
  line(`Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`);
  line(`Status: ${invoice.status}`);
  if (invoice.subscriptionId) line(`Subscription: ${invoice.subscriptionId}`);
  if (invoice.periodStart && invoice.periodEnd) {
    line(`Billing period: ${invoice.periodStart.toISOString().slice(0, 10)} to ${invoice.periodEnd.toISOString().slice(0, 10)}`);
  }
  y -= 10;
  line(`Bill to: ${invoice.customerName}`, 11, true);
  line(invoice.customerEmail);
  y -= 16;

  page.drawLine({ start: { x: left, y }, end: { x: width - left, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
  y -= 18;
  for (const item of invoice.items) {
    for (const wrapped of wrap(item.description)) line(wrapped, 10, false);
    line(`Qty ${item.quantity} x ${money(item.unitPriceMinor, invoice.currency)}   ${money(item.lineTotalMinor, invoice.currency)}`, 9, false, rgb(0.35, 0.37, 0.42));
    y -= 6;
  }
  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: width - left, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
  y -= 18;
  line(`Subtotal: ${money(invoice.subtotalMinor, invoice.currency)}`);
  if (invoice.taxMinor > 0) line(`Tax: ${money(invoice.taxMinor, invoice.currency)}`);
  if (invoice.discountMinor > 0) line(`Discount: ${money(invoice.discountMinor, invoice.currency)}`);
  if (invoice.setupFeeMinor > 0) line(`Setup fee: ${money(invoice.setupFeeMinor, invoice.currency)}`);
  line(`Total due: ${money(invoice.totalMinor, invoice.currency)}`, 13, true);
  if (invoice.paymentRef) line(`Sandbox payment reference: ${invoice.paymentRef}`, 9, false, rgb(0.35, 0.37, 0.42));
  y -= 20;
  for (const note of wrap("This is a Nexus Pay sandbox document, not a legally compliant tax invoice. No tax registration information is asserted.")) {
    line(note, 8, false, rgb(0.55, 0.57, 0.6));
  }

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), fileName: `nexus-pay-invoice-${invoice.invoiceNumber}.pdf` };
}
