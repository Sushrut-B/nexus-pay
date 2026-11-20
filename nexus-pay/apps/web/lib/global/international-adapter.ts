/** Release 18 — international payment provider contract. No provider is enabled by default. */

export interface InternationalPaymentCapabilities {
  beneficiaryValidation: boolean;
  quotes: boolean;
  transfers: boolean;
  status: boolean;
  cancellation: boolean;
  webhooks: boolean;
  refunds: boolean;
}

export interface InternationalPaymentAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: InternationalPaymentCapabilities;
  /** Currencies the provider can settle to, from provider configuration only. */
  supportedCorridors(): Promise<Array<{
    sourceCountry: string; destinationCountry: string; sourceCurrency: string;
    targetCurrency: string; enabled: boolean; notice: string;
  }>>;
  getHealth(): Promise<{ healthy: boolean; detail: string; checkedAt: Date }>;
}
