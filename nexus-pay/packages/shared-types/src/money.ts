/**
 * Money helpers shared by the server and the browser.
 *
 * Amounts are always integer minor units (paise for INR). No function in this
 * module converts money to a floating-point value for arithmetic. Formatting
 * splits the integer minor amount into whole and fractional parts as strings.
 */

const MAJOR_INPUT_PATTERN = /^\d+(\.\d{1,2})?$/;

export type MoneyParseResult =
  | { ok: true; amountMinor: number }
  | { ok: false; reason: "EMPTY" | "FORMAT" | "NON_POSITIVE" | "TOO_LARGE" };

/**
 * Parses a human-entered major-unit amount, such as "1,500.50" or "₹ 250",
 * into integer minor units without using floating-point arithmetic.
 */
export function parseMajorToMinor(input: string, maxMinor = 1_000_000_000_000): MoneyParseResult {
  const cleaned = input
    .trim()
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replace(/[,\s]/g, "");

  if (!cleaned) return { ok: false, reason: "EMPTY" };
  if (!MAJOR_INPUT_PATTERN.test(cleaned)) return { ok: false, reason: "FORMAT" };

  const [wholePart, fractionPart = ""] = cleaned.split(".");
  const amountMinor =
    BigInt(wholePart ?? "0") * 100n + BigInt(fractionPart.padEnd(2, "0").slice(0, 2));

  if (amountMinor <= 0n) return { ok: false, reason: "NON_POSITIVE" };
  if (amountMinor > BigInt(maxMinor)) return { ok: false, reason: "TOO_LARGE" };

  const numeric = Number(amountMinor);
  if (!Number.isSafeInteger(numeric)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, amountMinor: numeric };
}

/** Converts a validated integer minor amount to its exact major-unit input form. */
export function formatMinorAsInput(amountMinor: number | bigint): string {
  const minor = toSafeMinor(amountMinor);
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}${whole.toString()}.${fraction}`;
}

/**
 * Formats an integer minor amount as currency without floating-point math.
 * The locale controls digit grouping; the currency code controls the symbol.
 */
export function formatMinorCurrency(
  amountMinor: number | bigint,
  currency: string,
  locale = "en-IN",
): string {
  const minor = toSafeMinor(amountMinor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");

  const wholeText = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Number(whole));

  const currencySymbol =
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .formatToParts(0)
      .filter((part) => part.type === "currency")
      .map((part) => part.value)
      .join("") || currency;

  return `${negative ? "-" : ""}${currencySymbol}${wholeText}.${fraction}`;
}

/** Returns the exact minor units of a whole-major amount (for quick chips). */
export function majorToMinor(wholeMajor: number): number {
  if (!Number.isSafeInteger(wholeMajor) || wholeMajor < 0) {
    throw new RangeError("Whole major units must be a non-negative safe integer");
  }
  return wholeMajor * 100;
}

function toSafeMinor(amountMinor: number | bigint): bigint {
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(Math.trunc(amountMinor));
  if (minor > 9_007_199_254_740_991n || minor < -9_007_199_254_740_991n) {
    throw new RangeError("Minor amount is outside the JavaScript safe integer range");
  }
  return minor;
}

// ---------------------------------------------------------------------------
// Release 18 — explicit ISO-4217 minor-unit precision.
// The legacy helpers above assume 2 decimals (paise/cents). Global finance uses
// an explicit exponent table so zero-decimal (JPY) and three-decimal (KWD) minor
// units are handled correctly. No floating-point arithmetic is used.
// ---------------------------------------------------------------------------

/** Currencies exchanged in Release 18 and their ISO-4217 minor-unit exponents. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  INR: 2, USD: 2, EUR: 2, GBP: 2, SGD: 2, AED: 2, AUD: 2, CAD: 2, CHF: 2,
  JPY: 0, KWD: 3, BHD: 3, OMR: 3, TND: 3,
});

/** Default exponent for an unlisted currency (ISO-4217 majority). */
export const DEFAULT_CURRENCY_EXPONENT = 2;

export function currencyExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RangeError(`Invalid ISO-4217 currency code: ${currency}`);
  }
  return CURRENCY_EXPONENTS[code] ?? DEFAULT_CURRENCY_EXPONENT;
}

export function isValidCurrencyCode(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency.trim().toUpperCase());
}

/** Parses a major-unit decimal string into integer minor units for a currency. */
export function parseByCurrency(
  input: string,
  currency: string,
  maxMinor = 1_000_000_000_000,
): MoneyParseResult {
  const exponent = currencyExponent(currency);
  const cleaned = input.trim().replace(/[,\s]/g, "");
  if (!cleaned) return { ok: false, reason: "EMPTY" };
  const pattern = exponent === 0
    ? /^\d+$/
    : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(cleaned)) return { ok: false, reason: "FORMAT" };
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const scaled = BigInt(fraction.padEnd(exponent, "0").slice(0, exponent));
  const amountMinor = BigInt(whole) * 10n ** BigInt(exponent) + scaled;
  if (amountMinor <= 0n) return { ok: false, reason: "NON_POSITIVE" };
  if (amountMinor > BigInt(maxMinor)) return { ok: false, reason: "TOO_LARGE" };
  const numeric = Number(amountMinor);
  if (!Number.isSafeInteger(numeric)) return { ok: false, reason: "TOO_LARGE" };
  return { ok: true, amountMinor: numeric };
}

/** Formats integer minor units for a currency using its explicit exponent. */
export function formatByCurrency(
  amountMinor: number | bigint,
  currency: string,
  locale = "en-IN",
): string {
  const exponent = currencyExponent(currency);
  const minor = toSafeMinor(amountMinor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(exponent);
  const whole = absolute / divisor;
  const fraction = exponent === 0 ? "" : (absolute % divisor).toString().padStart(exponent, "0");
  const wholeText = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(whole));
  const symbol = new Intl.NumberFormat(locale, {
    style: "currency", currency,
    minimumFractionDigits: exponent, maximumFractionDigits: exponent,
  }).formatToParts(0).filter((p) => p.type === "currency").map((p) => p.value).join("") || currency;
  return `${negative ? "-" : ""}${symbol}${wholeText}${fraction ? "." + fraction : ""}`;
}

export type ConversionRounding = "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEIL";

/**
 * Converts integer minor units from one currency to another using a decimal rate
 * expressed as `rateNumerator / rateDenominator` (both positive integers), so the
 * rate itself never becomes a float. Rounds to the target currency's exponent.
 */
export function convertMinor(
  amountMinor: number | bigint,
  sourceCurrency: string,
  targetCurrency: string,
  rateNumerator: bigint | number,
  rateDenominator: bigint | number,
  rounding: ConversionRounding = "HALF_UP",
): number {
  const sourceExp = currencyExponent(sourceCurrency);
  const targetExp = currencyExponent(targetCurrency);
  const num = BigInt(rateNumerator);
  const den = BigInt(rateDenominator);
  if (num <= 0n || den <= 0n) throw new RangeError("Rate must be positive and finite");
  const sourceMinor = toSafeMinor(amountMinor);
  // major(source) = sourceMinor / 10^sourceExp
  // major(target) = major(source) * num / den
  // targetMinor  = major(target) * 10^targetExp
  const scaled = sourceMinor * num * 10n ** BigInt(targetExp);
  const divisor = den * 10n ** BigInt(sourceExp);
  const q = scaled / divisor;
  const remainder = scaled % divisor;
  let result = q;
  const twice = remainder * 2n;
  if (remainder !== 0n) {
    if (rounding === "CEIL" || (rounding === "HALF_UP" && twice >= divisor)) {
      result += 1n;
    } else if (rounding === "HALF_EVEN" && twice > divisor) {
      result += 1n;
    } else if (rounding === "HALF_EVEN" && twice === divisor && q % 2n === 1n) {
      result += 1n;
    }
  }
  const numeric = Number(result);
  if (!Number.isSafeInteger(numeric)) throw new RangeError("Converted amount exceeds safe integer range");
  return numeric;
}

/** Rounds a `numerator / denominator` rational to an integer using HALF_UP. */
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive");
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r * 2n >= denominator ? q + 1n : q;
}
