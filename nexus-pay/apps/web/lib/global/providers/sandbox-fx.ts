/**
 * Sandbox FX rate provider.
 *
 * The numbers below are DETERMINISTIC TEST FIXTURES, not market data. They are
 * classified as REFERENCE / HISTORICAL only and are never executable quotes.
 * A real provider requires licensing, attribution and verified credentials.
 */
import type { FxAdapter, FxCapabilities, FxHealth, FxRateData } from "@/lib/global/fx-adapter";
import { assertCurrencyPair, invertRateText } from "@/lib/global/currency-service";

export const SANDBOX_FX_NOTICE =
  "Sandbox test fixtures only. Rates are deterministic reference values, not live market data and not executable quotes. No currency conversion is performed by Nexus Pay.";

/** USD-based reference fixtures. All other pairs are derived via USD cross rates. */
const USD_REFERENCE: Record<string, string> = {
  USD: "1", INR: "83.125000", EUR: "0.921000", GBP: "0.784000",
  SGD: "1.342000", AED: "3.672500", AUD: "1.512000", CAD: "1.361000",
  JPY: "151.200000", CHF: "0.884000", KWD: "0.306500", BHD: "0.377000",
  OMR: "0.385000", TND: "3.045000",
};

function stableAsOf(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0));
}

function fixtureRate(base: string, quote: string): string {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  const usdB = USD_REFERENCE[b];
  const usdQ = USD_REFERENCE[q];
  if (!usdB || !usdQ) throw new Error(`Sandbox FX has no fixture for ${b} or ${q}`);
  // rate(base->quote) = USDperQuote / USDperBase as a rational; approximate to 9 dp
  const { numerator: nb, denominator: db } = ratio(usdQ);
  const { numerator: nbase, denominator: dbase } = ratio(usdB);
  const scaled = (nb * dbase * 1_000_000_000n) / (db * nbase);
  const whole = scaled / 1_000_000_000n;
  const fraction = (scaled % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function ratio(text: string): { numerator: bigint; denominator: bigint } {
  const [whole = "0", fraction = ""] = text.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return { numerator: BigInt(whole) * denominator + BigInt(fraction || "0"), denominator };
}

export class SandboxFxAdapter implements FxAdapter {
  readonly code = "sandbox-fx";
  readonly displayName = "Sandbox Reference Rates (test fixtures)";
  readonly mode = "SANDBOX" as const;
  readonly capabilities: FxCapabilities = {
    latest: true, historical: true, currencyDiscovery: true, health: true,
    executableQuotes: false,
  };

  async fetchLatest(base: string, quote: string): Promise<FxRateData> {
    assertCurrencyPair(base, quote);
    return {
      baseCurrency: base.toUpperCase(),
      quoteCurrency: quote.toUpperCase(),
      rateText: fixtureRate(base, quote),
      asOf: stableAsOf(),
      sourceRef: `sandbox-fixture:${base.toUpperCase()}/${quote.toUpperCase()}`,
      precision: 9,
    };
  }

  async fetchHistorical(base: string, quote: string, from: Date, to: Date): Promise<FxRateData[]> {
    assertCurrencyPair(base, quote);
    const current = fixtureRate(base, quote);
    const inverted = invertRateText(current, 9);
    const day = 24 * 60 * 60 * 1000;
    const results: FxRateData[] = [];
    let cursor = new Date(from);
    let index = 0;
    while (cursor <= to && index < 400) {
      // Small deterministic variance around the fixture for trend visualisation.
      const tweak = BigInt((index % 7) - 3) * 5n;
      const { numerator, denominator } = ratio(index % 2 === 0 ? current : inverted);
      const adjusted = (numerator * (100000n + tweak)) / denominator;
      const whole = adjusted / 100000n;
      const fraction = (adjusted % 100000n).toString().padStart(5, "0").replace(/0+$/, "");
      const rateText = fraction ? `${whole}.${fraction}` : whole.toString();
      results.push({
        baseCurrency: base.toUpperCase(),
        quoteCurrency: quote.toUpperCase(),
        rateText,
        asOf: new Date(cursor),
        sourceRef: `sandbox-fixture-historical:${base.toUpperCase()}/${quote.toUpperCase()}:${cursor.toISOString()}`,
        precision: 9,
      });
      cursor = new Date(cursor.getTime() + day);
      index += 1;
    }
    return results;
  }

  async supportedCurrencies(): Promise<string[]> {
    return Object.keys(USD_REFERENCE);
  }

  async getHealth(): Promise<FxHealth> {
    return { healthy: true, detail: SANDBOX_FX_NOTICE, checkedAt: new Date() };
  }
}
