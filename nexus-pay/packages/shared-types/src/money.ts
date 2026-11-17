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
