import type { InvestmentAccountType, InvestmentAssetClass, PriceFeedType } from "@nexus/database";

export interface InvestmentCapabilities {
  connections: boolean;
  consent: boolean;
  portfolioSync: boolean;
  holdings: boolean;
  transactions: boolean;
  valuations: boolean;
  documents: boolean;
  funds: boolean;
  instruments: boolean;
  prices: boolean;
  sips: boolean;
  webhooks: boolean;
}

export interface InvestmentAccountData {
  providerRef: string;
  name: string;
  accountType: InvestmentAccountType;
  maskedNumber?: string;
  currency: string;
}

export interface InvestmentHoldingData {
  providerRef: string;
  name: string;
  assetClass: InvestmentAssetClass;
  quantityMinor?: number;
  navMinor?: number;
  costMinor?: number;
  valueMinor: number;
  currency: string;
  providerReportedAt: Date;
  instrumentSymbol?: string;
}

export interface InvestmentTransactionData {
  providerRef: string;
  type: "PURCHASE" | "REDEMPTION" | "SIP" | "DIVIDEND" | "INTEREST" | "CORPORATE_ACTION" | "MATURITY" | "FEE" | "OTHER";
  quantityMinor?: number;
  priceMinor?: number;
  amountMinor: number;
  occurredAt: Date;
  settledAt?: Date;
  providerStatus?: string;
}

export interface InvestmentValuationData {
  valueMinor: number;
  costMinor: number;
  currency: string;
  valuedAt: Date;
}

export interface InstrumentPriceData {
  symbol: string;
  name: string;
  exchange?: string;
  category: InvestmentAssetClass;
  sector?: string;
  priceMinor: number;
  changeMinor: number;
  changePct: number;
  feedType: PriceFeedType;
  retrievedAt: Date;
}

export interface FundData {
  code: string;
  name: string;
  amc: string;
  category: InvestmentAssetClass;
  planType: string;
  optionType: string;
  navMinor?: number;
  navDate?: Date;
  expenseRatioBps?: number;
  inceptionDate?: Date;
  minInvestmentMinor?: number;
  minSipMinor?: number;
  exitLoad?: string;
  riskometer?: string;
  benchmark?: string;
  performance?: Record<string, number>;
  documents?: Array<{ name: string; url: string }>;
  retrievedAt: Date;
}

export interface SipData {
  providerRef: string;
  schemeCode: string;
  schemeName: string;
  amountMinor: number;
  frequency: string;
  startDate?: Date;
  nextInstalmentDate?: Date;
  instalmentsCompleted?: number;
  investedMinor?: number;
  currentValueMinor?: number;
  status: string;
  providerReportedAt: Date;
}

export interface InvestmentAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: InvestmentCapabilities;
  getProviderDetails(): { name: string; mode: string; capabilities: InvestmentCapabilities };
  getCapabilities(): InvestmentCapabilities;
  discoverAccounts(input: { userId: string; displayName?: string }): Promise<InvestmentAccountData[]>;
  getHoldings(accountRef: string): Promise<InvestmentHoldingData[]>;
  getTransactions(accountRef: string): Promise<InvestmentTransactionData[]>;
  getValuation(accountRef: string): Promise<InvestmentValuationData | null>;
  listFunds(): Promise<FundData[]>;
  getFund(code: string): Promise<FundData | null>;
  searchInstruments(query: string): Promise<InstrumentPriceData[]>;
  getPrice(symbol: string): Promise<InstrumentPriceData | null>;
  listSips(): Promise<SipData[]>;
  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean;
}
