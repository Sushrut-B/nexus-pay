import { createHash, createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type {
  InvestmentAdapter, InvestmentCapabilities, FundData, InstrumentPriceData,
  InvestmentAccountData, InvestmentHoldingData, InvestmentTransactionData,
  InvestmentValuationData, SipData,
} from "@/lib/investments/investment-adapter";

export const SANDBOX_INVESTMENTS_NOTICE =
  "SANDBOX DEMONSTRATION ONLY — no SEBI/AMFI registration, Account Aggregator status, broker, distributor or wealth-adviser authorization exists. Holdings, NAVs, prices, funds and SIPs below are labelled test fixtures, not real investments.";

const CAPABILITIES: InvestmentCapabilities = {
  connections: true, consent: true, portfolioSync: true, holdings: true,
  transactions: true, valuations: true, documents: false, funds: true,
  instruments: true, prices: true, sips: true, webhooks: true,
};

function ref(seed: string) { return `inv_${createHash("sha256").update(seed).digest("hex").slice(0, 18)}`; }

/** Clearly labelled sandbox provider. Enabled only by NEXUS_INVESTMENTS_SANDBOX_ENABLED. */
export class SandboxInvestmentAdapter implements InvestmentAdapter {
  readonly code = "sandbox-investments";
  readonly displayName = "Sandbox Demonstration Investment Provider";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  getProviderDetails() { return { name: this.displayName, mode: this.mode, capabilities: this.capabilities }; }
  getCapabilities() { return this.capabilities; }

  async discoverAccounts(input: { userId: string }): Promise<InvestmentAccountData[]> {
    return [{
      providerRef: ref(`account:${input.userId}`),
      name: "Sandbox Demo Portfolio (test fixture)",
      accountType: "MUTUAL_FUND",
      maskedNumber: "XXXX-0001",
      currency: "INR",
    }];
  }

  async getHoldings(accountRef: string): Promise<InvestmentHoldingData[]> {
    return [
      {
        providerRef: ref(`holding:${accountRef}:1`), name: "Sandbox Equity Fund (fixture)",
        assetClass: "EQUITY", quantityMinor: 100_000, navMinor: 12_345,
        costMinor: 1_000_000_00, valueMinor: 1_234_500_00, currency: "INR",
        providerReportedAt: new Date(), instrumentSymbol: "SBNEQ",
      },
      {
        providerRef: ref(`holding:${accountRef}:2`), name: "Sandbox Debt Fund (fixture)",
        assetClass: "DEBT", quantityMinor: 50_000, navMinor: 10_100,
        costMinor: 500_000_00, valueMinor: 505_000_00, currency: "INR",
        providerReportedAt: new Date(), instrumentSymbol: "SBNDEBT",
      },
    ];
  }

  async getTransactions(accountRef: string): Promise<InvestmentTransactionData[]> {
    return [{
      providerRef: ref(`tx:${accountRef}:1`), type: "SIP",
      amountMinor: 10_000_00, quantityMinor: 10_000, priceMinor: 10_000,
      occurredAt: new Date(Date.now() - 30 * 86_400_000),
      providerStatus: "COMPLETED",
    }];
  }

  async getValuation(): Promise<InvestmentValuationData> {
    return { valueMinor: 1_739_500_00, costMinor: 1_500_000_00, currency: "INR", valuedAt: new Date() };
  }

  async listFunds(): Promise<FundData[]> {
    const now = new Date();
    return [
      {
        code: "SBNEQ01", name: "Sandbox Equity Fund (fixture)", amc: "Sandbox AMC",
        category: "EQUITY", planType: "DIRECT", optionType: "GROWTH",
        navMinor: 12_345, navDate: now, expenseRatioBps: 65,
        inceptionDate: new Date("2020-01-01"), minInvestmentMinor: 500_00, minSipMinor: 100_00,
        exitLoad: "Illustrative only", riskometer: "Moderately High", benchmark: "Sandbox Index",
        performance: { "1Y": 1100, "3Y": 900 },
        documents: [{ name: "Sandbox factsheet (test)", url: "https://example.invalid/factsheet" }],
        retrievedAt: now,
      },
      {
        code: "SBNDBT01", name: "Sandbox Debt Fund (fixture)", amc: "Sandbox AMC",
        category: "DEBT", planType: "DIRECT", optionType: "GROWTH",
        navMinor: 10_100, navDate: now, expenseRatioBps: 35,
        minInvestmentMinor: 500_00, minSipMinor: 100_00,
        riskometer: "Moderate", benchmark: "Sandbox Debt Index",
        performance: { "1Y": 600 }, documents: [], retrievedAt: now,
      },
    ];
  }

  async getFund(code: string) { return (await this.listFunds()).find((fund) => fund.code === code) ?? null; }

  async searchInstruments(query: string): Promise<InstrumentPriceData[]> {
    const q = query.trim().toUpperCase();
    const all: InstrumentPriceData[] = [
      { symbol: "SBNEQ", name: "Sandbox Equity Ltd (fixture)", exchange: "NSE", category: "EQUITY", sector: "Test", priceMinor: 12_345_00, changeMinor: 125_00, changePct: 102, feedType: "SANDBOX", retrievedAt: new Date() },
      { symbol: "SBNETF", name: "Sandbox Index ETF (fixture)", exchange: "NSE", category: "INDEX", priceMinor: 5_000_00, changeMinor: -25_00, changePct: -50, feedType: "SANDBOX", retrievedAt: new Date() },
    ];
    return all.filter((item) => item.symbol.includes(q) || item.name.toUpperCase().includes(q));
  }

  async getPrice(symbol: string) { return (await this.searchInstruments(symbol)).find((item) => item.symbol === symbol) ?? null; }

  async listSips(): Promise<SipData[]> {
    return [{
      providerRef: ref("sip:1"), schemeCode: "SBNEQ01", schemeName: "Sandbox Equity Fund (fixture)",
      amountMinor: 10_000_00, frequency: "MONTHLY",
      nextInstalmentDate: new Date(Date.now() + 15 * 86_400_000),
      instalmentsCompleted: 12, investedMinor: 120_000_00,
      currentValueMinor: 135_000_00, status: "ACTIVE", providerReportedAt: new Date(),
    }];
  }

  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean {
    const expected = createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
    return expected === input.signature;
  }
}

export { CAPABILITIES as SANDBOX_INVESTMENTS_CAPABILITIES };

