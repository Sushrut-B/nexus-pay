import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getReceiptRecord } from "@/lib/payments/transaction-service";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMinorCurrency } from "@nexus/shared-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }
    const { id } = await context.params;
    const record = await getReceiptRecord(auth.user.id, id);

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.059, 0.09, 0.165);
    const muted = rgb(0.36, 0.4, 0.47);
    const line = rgb(0.88, 0.86, 0.83);
    const success = rgb(0.09, 0.45, 0.32);
    const margin = 56;
    let y = 770;

    page.drawText("NEXUS PAY", { x: margin, y, size: 10, font: bold, color: muted });
    y -= 34;
    page.drawText(record.kind === "FUNDING" ? "Funding receipt" : "Payment receipt", {
      x: margin,
      y,
      size: 26,
      font: bold,
      color: navy,
    });
    y -= 22;
    page.drawText("Verified against the Raftline replicated ledger", {
      x: margin,
      y,
      size: 10,
      font,
      color: muted,
    });

    y -= 36;
    page.drawRectangle({
      x: margin,
      y: y - 20,
      width: 86,
      height: 24,
      color: rgb(0.9, 0.96, 0.92),
    });
    page.drawText("COMPLETED", {
      x: margin + 12,
      y: y - 12,
      size: 9,
      font: bold,
      color: success,
    });

    y -= 70;
    const amount = formatMinorCurrency(
      Number(record.amountMinor),
      record.currency,
    ).replace("₹", "INR ");
    page.drawText(amount, { x: margin, y, size: 32, font: bold, color: navy });
    y -= 26;
    page.drawText(
      record.kind === "FUNDING" ? "Simulated sandbox funding" : "Nexus Pay transfer",
      { x: margin, y, size: 11, font, color: muted },
    );

    y -= 42;
    page.drawLine({
      start: { x: margin, y },
      end: { x: 595.28 - margin, y },
      thickness: 1,
      color: line,
    });
    y -= 30;

    const rows: Array<[string, string]> = [
      ["Reference", record.paymentRef ?? "Not available"],
      ["Date", formatDateTime(record.occurredAt.toISOString())],
      ["Sender", receiptSender(record)],
      ["Recipient", receiptRecipient(record)],
      ["Type", record.kind === "FUNDING" ? "Simulated sandbox funding" : "P2P payment"],
      ["Rail", record.kind === "FUNDING" ? "Sandbox reserve credit" : "INTERNAL_BOOK"],
      ["Currency", record.currency],
    ];

    for (const [label, value] of rows) {
      page.drawText(label, { x: margin, y, size: 10, font, color: muted });
      page.drawText(value, { x: margin + 150, y, size: 10, font: bold, color: navy });
      y -= 28;
    }

    if (record.description) {
      page.drawText("Note", { x: margin, y, size: 10, font, color: muted });
      page.drawText(record.description, {
        x: margin + 150,
        y,
        size: 10,
        font,
        color: navy,
        maxWidth: 320,
      });
      y -= 28;
    }

    y -= 20;
    page.drawLine({
      start: { x: margin, y },
      end: { x: 595.28 - margin, y },
      thickness: 1,
      color: line,
    });
    y -= 30;

    const notes =
      record.kind === "FUNDING"
        ? [
            "SIMULATED SANDBOX FUNDING. This credit is test money inside the Nexus Pay",
            "sandbox. It is not a bank deposit, UPI transfer, or real funds.",
            "The ledger receipt was read back from Raftline before this receipt was issued.",
            "Raftline funding receipts do not currently expose a log index.",
          ]
        : [
            "The Raftline settlement receipt matched the payment reference, amount,",
            "currency, sender account and recipient account before this receipt was issued.",
            "This receipt is not issued for processing, failed or unconfirmed payments.",
          ];

    for (const text of notes) {
      page.drawText(text, { x: margin, y, size: 9.5, font, color: muted });
      y -= 17;
    }

    y -= 22;
    page.drawText(`Issued ${formatDate(new Date())}`, {
      x: margin,
      y,
      size: 9,
      font,
      color: muted,
    });
    page.drawText("Nexus Pay sandbox - release 2", {
      x: 595.28 - margin - 150,
      y: 48,
      size: 8,
      font,
      color: muted,
    });

    const bytes = await pdf.save();
    const safeRef = (record.paymentRef ?? record.id).replace(/[^A-Za-z0-9_-]/g, "");

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="nexus-pay-receipt-${safeRef}.pdf"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

type ReceiptRecord = Awaited<ReturnType<typeof getReceiptRecord>>;

function partyLabel(name: string | null, username: string | null): string {
  const label = username ? `${name ?? "Nexus Pay customer"} (@${username})` : name ?? "Nexus Pay customer";
  return label.length > 54 ? `${label.slice(0, 51)}...` : label;
}

function receiptSender(record: ReceiptRecord): string {
  if (record.kind === "FUNDING") return "Simulated sandbox reserve";
  const owner = partyLabel(
    record.user.profile?.displayName ?? record.user.fullName,
    record.user.username,
  );
  return record.direction === "SENT"
    ? owner
    : partyLabel(record.counterpartyName, record.counterpartyUsername);
}

function receiptRecipient(record: ReceiptRecord): string {
  const owner = partyLabel(
    record.user.profile?.displayName ?? record.user.fullName,
    record.user.username,
  );
  if (record.kind === "FUNDING") return owner;
  return record.direction === "SENT"
    ? partyLabel(record.counterpartyName, record.counterpartyUsername)
    : owner;
}
