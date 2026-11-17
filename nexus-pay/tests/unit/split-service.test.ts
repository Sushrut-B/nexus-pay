import { describe, expect, it } from "vitest";
import {
  allocateCustom,
  allocateEqual,
  allocatePercentage,
  allocateShares,
  calculateSplit,
} from "../../apps/web/lib/social/split-service";

const people = ["alice", "bob", "charlie", "diana"];
const participants = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe("deterministic split engine", () => {
  it("divides equal shares exactly, including paise remainders", () => {
    const result = allocateEqual(10_000, participants(...people));
    expect(result.map((r) => r.amountMinor)).toEqual([2500, 2500, 2500, 2500]);
    expect(result.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(10_000);

    const thirds = allocateEqual(10_000, participants("alice", "bob", "charlie"));
    expect(thirds.map((r) => r.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(thirds.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(10_000);
  });

  it("is stable for the same input and allocates remainder by largest fraction", () => {
    const first = allocateEqual(100, participants("a", "b", "c"));
    const second = allocateEqual(100, participants("a", "b", "c"));
    expect(first).toEqual(second);
    expect(first.map((r) => r.amountMinor)).toEqual([34, 33, 33]);
  });

  it("accepts exact custom allocations and rejects mismatches", () => {
    const result = allocateCustom(200_000, [
      { userId: "a", amountMinor: 50_000 },
      { userId: "b", amountMinor: 50_000 },
      { userId: "c", amountMinor: 70_000 },
      { userId: "d", amountMinor: 30_000 },
    ]);
    expect(result.map((r) => r.amountMinor)).toEqual([50_000, 50_000, 70_000, 30_000]);
    expect(() =>
      allocateCustom(200_000, [
        { userId: "a", amountMinor: 50_000 },
        { userId: "b", amountMinor: 60_000 },
      ]),
    ).toThrow(/add up/);
  });

  it("validates percentages sum to exactly 100", () => {
    const result = allocatePercentage(10_000, [
      { userId: "a", percentage: 50 },
      { userId: "b", percentage: 30 },
      { userId: "c", percentage: 20 },
    ]);
    expect(result.map((r) => r.amountMinor)).toEqual([5000, 3000, 2000]);
    expect(result.map((r) => r.percentage)).toEqual([50, 30, 20]);
    expect(() =>
      allocatePercentage(10_000, [
        { userId: "a", percentage: 50 },
        { userId: "b", percentage: 49 },
      ]),
    ).toThrow(/100/);
  });

  it("allocates shares proportionally with deterministic rounding", () => {
    const result = allocateShares(10_000, [
      { userId: "a", shares: 2 },
      { userId: "b", shares: 1 },
      { userId: "c", shares: 1 },
    ]);
    expect(result.map((r) => r.amountMinor)).toEqual([5000, 2500, 2500]);
    expect(result.map((r) => r.shares)).toEqual([2, 1, 1]);
    expect(
      allocateShares(100, [
        { userId: "a", shares: 1 },
        { userId: "b", shares: 1 },
        { userId: "c", shares: 1 },
      ]).reduce((s, r) => s + r.amountMinor, 0),
    ).toBe(100);
  });

  it("rejects unsafe totals and duplicate participants for every method", () => {
    expect(() => allocateEqual(0, participants("a"))).toThrow();
    expect(() => calculateSplit("EQUAL", 100, [
      { userId: "a" },
      { userId: "a" },
    ])).toThrow(/twice/);
    expect(() => allocateShares(100, [{ userId: "a", shares: 0 }])).toThrow(/greater than zero/);
  });
});
