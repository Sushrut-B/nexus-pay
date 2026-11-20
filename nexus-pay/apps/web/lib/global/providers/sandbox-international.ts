/**
 * Sandbox international payments provider.
 *
 * It advertises NO money-movement capability. It exists so the state machine,
 * webhook verification and reconciliation paths can be exercised without
 * pretending a transfer occurred. Real transfers require an RBI-authorized
 * arrangement through Authorised Dealers; Nexus Pay has none.
 */
import type {
  InternationalPaymentAdapter, InternationalPaymentCapabilities,
} from "@/lib/global/international-adapter";

export const SANDBOX_INTERNATIONAL_NOTICE =
  "Sandbox only. This provider cannot validate beneficiaries with a real authority, issue executable quotes, submit transfers, or process refunds. No money is moved. Real outward remittances require an RBI-authorised arrangement through Authorised Dealer banks.";

const CAPABILITIES: InternationalPaymentCapabilities = {
  beneficiaryValidation: false,
  quotes: false,
  transfers: false,
  status: false,
  cancellation: false,
  webhooks: true, // signature-verification path can be tested; no real events
  refunds: false,
};

export class SandboxInternationalAdapter implements InternationalPaymentAdapter {
  readonly code = "sandbox-intl";
  readonly displayName = "Sandbox International Payments (no money movement)";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  async supportedCorridors() {
    return [
      {
        sourceCountry: "IN", destinationCountry: "US", sourceCurrency: "INR", targetCurrency: "USD",
        enabled: false, notice: SANDBOX_INTERNATIONAL_NOTICE,
      },
      {
        sourceCountry: "IN", destinationCountry: "GB", sourceCurrency: "INR", targetCurrency: "GBP",
        enabled: false, notice: SANDBOX_INTERNATIONAL_NOTICE,
      },
    ];
  }

  async getHealth() {
    return { healthy: true, detail: SANDBOX_INTERNATIONAL_NOTICE, checkedAt: new Date() };
  }
}
