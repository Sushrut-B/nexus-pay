/**
 * Release 19 — server-side linked-record resolution.
 *
 * A client may only supply an opaque reference. Ownership is always resolved
 * here; a case never stores an unverified reference. Linked records are read
 * only — no payment, refund, booking or provider state is modified.
 */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getPaymentView } from "@/lib/payments/payment-service";
import type { SupportLinkType } from "@nexus/shared-types";

export interface ResolvedLink {
  linkedReference: string;
  linkedSummary: string;
  authoritativeStatus: string;
  providerReference: string | null;
}

function notFound(): never {
  throw new ApiError(404, "VALIDATION_ERROR", "The linked record was not found or you do not have access to it.");
}

export async function resolveLink(userId: string, type: SupportLinkType, reference: string): Promise<ResolvedLink> {
  switch (type) {
    case "WALLET_TRANSACTION":
    case "P2P_PAYMENT": {
      const tx = await prisma.transactionRecord.findFirst({
        where: { userId, OR: [{ id: reference }, { paymentRef: reference }] },
      });
      if (!tx) notFound();
      // Authoritative status is read through the existing payment service when
      // a payment reference exists; otherwise the verified transaction status.
      let status: string = tx.status;
      if (tx.paymentIntentId) {
        try {
          const view = await getPaymentView(tx.paymentIntentId, userId);
          status = (view as { status?: string }).status ?? status;
        } catch { /* keep the verified transaction status */ }
      }
      return {
        linkedReference: tx.paymentRef ?? tx.id,
        linkedSummary: `${tx.currency} ${Number(tx.amountMinor).toString()} minor units · wallet transaction`,
        authoritativeStatus: status,
        providerReference: null,
      };
    }
    case "MERCHANT_ORDER": {
      const order = await prisma.merchantOrder.findFirst({ where: { id: reference } });
      if (!order) notFound();
      const payment = await prisma.merchantPayment.findFirst({
        where: { orderId: order.id, customerUserId: userId },
      });
      if (!payment) notFound();
      return {
        linkedReference: order.id,
        linkedSummary: `Merchant order · ${order.currency}${payment ? ` · ${payment.paymentRef}` : ""}`,
        authoritativeStatus: payment ? payment.status : order.status,
        providerReference: null,
      };
    }
    case "SUBSCRIPTION_INVOICE": {
      const invoice = await prisma.invoice.findFirst({ where: { id: reference, customerUserId: userId } });
      if (!invoice) notFound();
      return {
        linkedReference: invoice.id,
        linkedSummary: `Subscription invoice · ${invoice.currency}`,
        authoritativeStatus: invoice.status,
        providerReference: invoice.paymentRef ?? null,
      };
    }
    case "BILL_PAYMENT": {
      const intent = await prisma.billPaymentIntent.findFirst({ where: { userId, OR: [{ id: reference }, { reference }] } });
      if (!intent) notFound();
      return {
        linkedReference: intent.reference,
        linkedSummary: `Bill payment · ${Number(intent.amountMinor).toString()} minor units`,
        authoritativeStatus: intent.status,
        providerReference: intent.providerRef ?? null,
      };
    }
    case "TRAVEL_BOOKING": {
      const booking = await prisma.travelBooking.findFirst({ where: { userId, OR: [{ id: reference }, { reference }] } });
      if (!booking) notFound();
      return {
        linkedReference: booking.reference,
        linkedSummary: `Travel booking · ${booking.currency} ${Number(booking.amountMinor).toString()} minor units`,
        authoritativeStatus: booking.status,
        providerReference: booking.providerRef ?? null,
      };
    }
    case "INVESTMENT_CONNECTION": {
      const connection = await prisma.investmentConnection.findFirst({ where: { id: reference, userId } });
      if (!connection) notFound();
      return {
        linkedReference: connection.id,
        linkedSummary: "Investment provider connection",
        authoritativeStatus: connection.status,
        providerReference: connection.providerRef ?? null,
      };
    }
    case "TAX_DOCUMENT": {
      const document = await prisma.taxDocument.findFirst({ where: { id: reference, userId } });
      if (!document) notFound();
      return {
        linkedReference: document.id,
        linkedSummary: `Tax document · ${document.kind}`,
        authoritativeStatus: document.status,
        providerReference: document.providerRef ?? null,
      };
    }
    case "INTERNATIONAL_TRANSFER": {
      const transfer = await prisma.internationalTransfer.findFirst({ where: { id: reference, userId } });
      if (!transfer) notFound();
      return {
        linkedReference: transfer.id,
        linkedSummary: `International transfer · ${transfer.sourceCurrency}→${transfer.targetCurrency}`,
        authoritativeStatus: `${transfer.state} / ${transfer.complianceState}`,
        providerReference: transfer.providerRef ?? null,
      };
    }
    case "GENERAL":
      if (!reference) notFound();
      return {
        linkedReference: reference,
        linkedSummary: "General reference",
        authoritativeStatus: "NOT_APPLICABLE",
        providerReference: null,
      };
    default:
      throw new ApiError(400, "VALIDATION_ERROR", "Unsupported link type");
  }
}

/** Re-read authoritative status for a linked operation (read-only sync). */
export async function refreshAuthoritativeStatus(input: {
  type: SupportLinkType; reference: string; userId: string;
}): Promise<string> {
  const resolved = await resolveLink(input.userId, input.type, input.reference);
  return resolved.authoritativeStatus;
}
