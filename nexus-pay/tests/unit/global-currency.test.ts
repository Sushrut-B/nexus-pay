import { describe, expect, it } from "vitest";
import {
  convertMinor,
  currencyExponent,
  formatByCurrency,
  isValidCurrencyCode,
  parseByCurrency,
  roundRatio,
} from "../../packages/shared-types/src/money";
import {
  assertCurrencyPair,
  convertWithRate,
  decimalToRatio,
  invertRateText,
  listCurrencies,
  resolveDisplayCurrency,
} from "../../apps/web/lib/global/currency-service";

describe("Release 18 — explicit currency precision", () => {
  it("uses ISO-4217 exponents, including zero- and three-decimal currencies", () => {
    expect(currencyExponent("INR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("usd")).toBe(2);
    expect(() => currencyExponent("US1")).toThrow(RangeError);
  });

  it("validates 3-letter ISO-4217 codes", () => {
    expect(isValidCurrencyCode("USD")).toBe(true);
    expect(isValidCurrencyCode("usd")).toBe(true);
    expect(isValidCurrencyCode("US")).toBe(false);
    expect(isValidCurrencyCode("USDX")).toBe(false);
  });

  it("parses major amounts using the currency exponent", () => {
    expect(parseByCurrency("100.50", "USD")).toEqual({ ok: true, amountMinor: 10050 });
    expect(parseByCurrency("151", "JPY")).toEqual({ ok: true, amountMinor: 151 });
    expect(parseByCurrency("1.234", "KWD")).toEqual({ ok: true, amountMinor: 1234 });
    expect(parseByCurrency("1.234", "USD").ok).toBe(false);
    expect(parseByCurrency("151.5", "JPY").ok).toBe(false);
    expect(parseByCurrency("0", "INR").ok).toBe(false);
  });

  it("formats zero- and three-decimal currencies correctly", () => {
    expect(formatByCurrency(151, "JPY")).not.toContain(".");
    expect(formatByCurrency(1234, "KWD")).toContain(".");
    expect(formatByCurrency(10050, "USD")).toContain(".");
  });

  it("converts USD→INR and INR→USD with exact bigint arithmetic", () => {
    expect(convertMinor(10000, "USD", "INR", 83125n, 1000n)).toBe(831250);
    expect(convertWithRate(831250, "INR", "USD", "0.012030")).toBe(10000);
  });

  it("handles zero-decimal JPY and three-decimal KWD targets", () => {
    expect(convertWithRate(1000, "JPY", "INR", "0.53")).toBe(53000);
    expect(convertWithRate(100, "INR", "KWD", "0.0075")).toBe(8); // HALF_UP of 7.5 → 8 fils
  });

  it("applies rounding modes deterministically", () => {
    expect(convertMinor(1, "USD", "USD", 1n, 2n, "HALF_UP")).toBe(1);
    expect(convertMinor(1, "USD", "USD", 1n, 2n, "FLOOR")).toBe(0);
    expect(convertMinor(1, "USD", "USD", 1n, 2n, "CEIL")).toBe(1);
    expect(roundRatio(5n, 2n)).toBe(3n);
    expect(roundRatio(4n, 2n)).toBe(2n);
  });

  it("rejects invalid pairs, zero rates and division-by-zero", () => {
    expect(() => assertCurrencyPair("INR", "INR")).toThrow(RangeError);
    expect(() => assertCurrencyPair("US", "INR")).toThrow(RangeError);
    expect(() => convertWithRate(100, "USD", "INR", "0")).toThrow(RangeError);
    expect(() => decimalToRatio("-1.5")).toThrow(RangeError);
    expect(() => roundRatio(1n, 0n)).toThrow(RangeError);
  });

  it("handles large amounts within the safe integer range", () => {
    expect(convertMinor(1_000_000_000_000, "INR", "INR", 1n, 1n)).toBe(1_000_000_000_000);
    expect(() => convertMinor(9_007_199_254_740_991n, "INR", "INR", 2n, 1n)).toThrow(RangeError);
  });

  it("exposes exact decimal ratios and inversion", () => {
    expect(decimalToRatio("83.125")).toEqual({ numerator: 83125n, denominator: 1000n });
    expect(invertRateText("4")).toBe("0.25");
    expect(invertRateText("83.125", 6)).toBe("0.01203");
  });

  it("lists configured currencies with INR as the only settlement currency", () => {
    const currencies = listCurrencies();
    expect(currencies.map((c) => c.code)).toContain("JPY");
    expect(currencies.filter((c) => c.transactableWallet).map((c) => c.code)).toEqual(["INR"]);
    expect(resolveDisplayCurrency("JPY")).toBe("JPY");
  });
});
