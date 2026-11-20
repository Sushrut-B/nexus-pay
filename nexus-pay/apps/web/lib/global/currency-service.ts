/**
 * Release 18 — currency catalogue and exact-decimal helpers.
 *
 * Rates are decimal strings, never JavaScript floats. `decimalToRatio` turns a
 * rate such as "83.125" into an exact bigint fraction used by `convertMinor`.
 * Nothing here is a market feed; the configured providers supply rate values.
 */

import {
  convertMinor,
  currencyExponent,
  formatByCurrency,
  isValidCurrencyCode,
  parseByCurrency,
} from "@nexus/shared-types";
import { getServerEnv } from "@/lib/env";

export interface CurrencyDefinition {
  code: string;
  name: string;
  exponent: number;
  /** INR is the only currency Nexus Pay can settle in its Raftline wallet. */
  transactableWallet: boolean;
}

const NAMES: Record<string, string> = {
  INR: "Indian Rupee", USD: "US Dollar", EUR: "Euro", GBP: "British Pound",
  SGD: "Singapore Dollar", AED: "UAE Dirham", AUD: "Australian Dollar",
  CAD: "Canadian Dollar", JPY: "Japanese Yen", CHF: "Swiss Franc",
  KWD: "Kuwaiti Dinar", BHD: "Bahraini Dinar", OMR: "Omani Rial", TND: "Tunisian Dinar",
};

/** Display/valuation currencies. Wallet settlement is INR only. */
export const CONFIGURED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD", "JPY", "CHF",
] as const;

export function listCurrencies(): CurrencyDefinition[] {
  return CONFIGURED_CURRENCIES.map((code) => ({
    code,
    name: NAMES[code] ?? code,
    exponent: currencyExponent(code),
    transactableWallet: code === "INR",
  }));
}

export function resolveDisplayCurrency(requested?: string | null): string {
  if (requested && isValidCurrencyCode(requested)) return requested.toUpperCase();
  return getServerEnv().NEXUS_GLOBAL_DEFAULT_DISPLAY_CURRENCY;
}

export function assertCurrencyPair(base: string, quote: string): void {
  const a = base?.trim().toUpperCase();
  const b = quote?.trim().toUpperCase();
  if (!isValidCurrencyCode(a) || !isValidCurrencyCode(b) || a === b) {
    throw new RangeError("A currency pair must be two different 3-letter ISO-4217 codes");
  }
}

/** Parses a positive decimal rate string into an exact (numerator, denominator) pair. */
export function decimalToRatio(text: string): { numerator: bigint; denominator: bigint } {
  if (typeof text !== "string" || !/^\d+(\.\d{1,12})?$/.test(text.trim())) {
    throw new RangeError(`Invalid decimal rate: ${text}`);
  }
  const [whole = "0", fraction = ""] = text.trim().split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  if (numerator <= 0n) throw new RangeError("Rate must be greater than zero");
  return { numerator, denominator };
}

/** Inverse of a rate, returned as an exact decimal string (no float). */
export function invertRateText(text: string, precision = 12): string {
  const { numerator, denominator } = decimalToRatio(text);
  const scaled = (denominator * 10n ** BigInt(precision)) / numerator;
  const raw = scaled.toString().padStart(precision + 1, "0");
  const whole = raw.slice(0, raw.length - precision);
  const fraction = raw.slice(raw.length - precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function convertWithRate(
  amountMinor: number | bigint,
  source: string,
  target: string,
  rateText: string,
  rounding: "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEIL" = "HALF_UP",
): number {
  const { numerator, denominator } = decimalToRatio(rateText);
  return convertMinor(amountMinor, source, target, numerator, denominator, rounding);
}

export { currencyExponent, formatByCurrency, isValidCurrencyCode, parseByCurrency };
