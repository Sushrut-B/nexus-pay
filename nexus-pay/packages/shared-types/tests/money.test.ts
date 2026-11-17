import { describe, expect, it } from "vitest";
import {
  formatMinorAsInput,
  formatMinorCurrency,
  majorToMinor,
  parseMajorToMinor,
} from "../src/money";

describe("integer minor-unit money helpers", () => {
  it("parses grouped and symbol-prefixed major amounts into exact paise", () => {
    expect(parseMajorToMinor("1,500.50")).toEqual({ ok: true, amountMinor: 150050 });
    expect(parseMajorToMinor("₹ 250")).toEqual({ ok: true, amountMinor: 25000 });
    expect(parseMajorToMinor("Rs.99.9")).toEqual({ ok: true, amountMinor: 9990 });
    expect(parseMajorToMinor("0.01")).toEqual({ ok: true, amountMinor: 1 });
  });

  it("rejects empty, malformed, non-positive and oversized amounts", () => {
    expect(parseMajorToMinor("   ")).toEqual({ ok: false, reason: "EMPTY" });
    expect(parseMajorToMinor("12.345")).toEqual({ ok: false, reason: "FORMAT" });
    expect(parseMajorToMinor("abc")).toEqual({ ok: false, reason: "FORMAT" });
    expect(parseMajorToMinor("0")).toEqual({ ok: false, reason: "NON_POSITIVE" });
    expect(parseMajorToMinor("0.00")).toEqual({ ok: false, reason: "NON_POSITIVE" });
    expect(parseMajorToMinor("1000", 99999)).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("formats without floating-point rounding", () => {
    expect(formatMinorAsInput(150050)).toBe("1500.50");
    expect(formatMinorAsInput(1n)).toBe("0.01");
    expect(formatMinorAsInput(-1234)).toBe("-12.34");
    expect(majorToMinor(1500)).toBe(150000);
    expect(formatMinorCurrency(150050, "INR")).toContain("1,500.50");
    expect(formatMinorCurrency(-1234, "INR")).toContain("12.34");
  });

  it("guards unsafe conversions", () => {
    expect(() => majorToMinor(-1)).toThrow(RangeError);
    expect(() => majorToMinor(1.5)).toThrow(RangeError);
    expect(() => formatMinorAsInput(Number.MAX_SAFE_INTEGER + 100)).toThrow(RangeError);
  });
});
