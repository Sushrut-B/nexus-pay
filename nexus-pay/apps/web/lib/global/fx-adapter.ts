/** Release 18 — exchange-rate provider contract. No provider is enabled by default. */

export interface FxCapabilities {
  latest: boolean;
  historical: boolean;
  currencyDiscovery: boolean;
  health: boolean;
  executableQuotes: boolean;
}

export interface FxRateData {
  baseCurrency: string;
  quoteCurrency: string;
  /** Exact decimal string, e.g. "83.125000". Never a float. */
  rateText: string;
  asOf: Date;
  sourceRef: string | null;
  precision: number;
}

export interface FxHealth {
  healthy: boolean;
  detail: string;
  checkedAt: Date;
}

export interface FxAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: FxCapabilities;
  fetchLatest(baseCurrency: string, quoteCurrency: string): Promise<FxRateData>;
  fetchHistorical(
    baseCurrency: string,
    quoteCurrency: string,
    from: Date,
    to: Date,
  ): Promise<FxRateData[]>;
  supportedCurrencies(): Promise<string[]>;
  getHealth(): Promise<FxHealth>;
}
