import { describe, expect, it } from "vitest";
import {
  BalanceEngineError,
  computeGroupBalances,
  simplifyDebts,
} from "../../apps/web/lib/social/balance-engine";

describe("group balance engine", () => {
  it("computes the worked example from the specification", () => {
    const balances = computeGroupBalances(
      ["alice", "bob", "charlie"],
      [
        {
          id: "e1",
          totalAmountMinor: 500_000,
          paidByUserId: "alice",
          splits: [
            { userId: "alice", shareAmountMinor: 200_000 },
            { userId: "bob", shareAmountMinor: 200_000 },
            { userId: "charlie", shareAmountMinor: 100_000 },
          ],
        },
        {
          id: "e2",
          totalAmountMinor: 100_000,
          paidByUserId: "bob",
          splits: [{ userId: "charlie", shareAmountMinor: 100_000 }],
        },
      ],
      [],
    );
    expect(balances).toEqual([
      { userId: "alice", netMinor: 300_000 },
      { userId: "bob", netMinor: -100_000 },
      { userId: "charlie", netMinor: -200_000 },
    ]);
    expect(balances.reduce((sum, b) => sum + b.netMinor, 0)).toBe(0);
  });

  it("reduces obligations only when a settlement is confirmed", () => {
    const expenses = [
      {
        id: "e1",
        totalAmountMinor: 100_000,
        paidByUserId: "alice",
        splits: [
          { userId: "alice", shareAmountMinor: 20_000 },
          { userId: "bob", shareAmountMinor: 40_000 },
          { userId: "charlie", shareAmountMinor: 40_000 },
        ],
      },
    ];
    const before = computeGroupBalances(["alice", "bob", "charlie"], expenses, []);
    expect(before.find((b) => b.userId === "bob")?.netMinor).toBe(-40_000);

    const after = computeGroupBalances(["alice", "bob", "charlie"], expenses, [
      {
        id: "s1",
        payerUserId: "bob",
        payeeUserId: "alice",
        amountMinor: 15_000,
      },
    ]);
    expect(after.find((b) => b.userId === "bob")?.netMinor).toBe(-25_000);
    expect(after.find((b) => b.userId === "alice")?.netMinor).toBe(65_000);
    expect(after.reduce((sum, b) => sum + b.netMinor, 0)).toBe(0);
  });

  it("supports multiple payers and different participants per expense", () => {
    const balances = computeGroupBalances(
      ["a", "b", "c"],
      [
        {
          id: "e1",
          totalAmountMinor: 30_000,
          paidByUserId: "a",
          splits: [
            { userId: "a", shareAmountMinor: 10_000 },
            { userId: "b", shareAmountMinor: 20_000 },
          ],
        },
        {
          id: "e2",
          totalAmountMinor: 9_000,
          paidByUserId: "b",
          splits: [
            { userId: "b", shareAmountMinor: 3_000 },
            { userId: "c", shareAmountMinor: 6_000 },
          ],
        },
      ],
      [],
    );
    expect(balances).toEqual([
      { userId: "a", netMinor: 20_000 },
      { userId: "b", netMinor: -14_000 },
      { userId: "c", netMinor: -6_000 },
    ]);
  });

  it("surfaces internal inconsistencies instead of showing misleading balances", () => {
    expect(() =>
      computeGroupBalances(
        ["a", "b"],
        [
          {
            id: "bad",
            totalAmountMinor: 10_000,
            paidByUserId: "a",
            splits: [
              { userId: "a", shareAmountMinor: 4_000 },
              { userId: "b", shareAmountMinor: 4_000 },
            ],
          },
        ],
        [],
      ),
    ).toThrow(BalanceEngineError);
  });

  it("simplifies debts deterministically without changing obligations", () => {
    const transfers = simplifyDebts([
      { userId: "a", netMinor: 100_000 },
      { userId: "b", netMinor: -60_000 },
      { userId: "c", netMinor: -40_000 },
    ]);
    expect(transfers).toEqual([
      { payerUserId: "b", payeeUserId: "a", amountMinor: 60_000 },
      { payerUserId: "c", payeeUserId: "a", amountMinor: 40_000 },
    ]);
    const again = simplifyDebts([
      { userId: "a", netMinor: 100_000 },
      { userId: "b", netMinor: -60_000 },
      { userId: "c", netMinor: -40_000 },
    ]);
    expect(again).toEqual(transfers);
    expect(transfers.reduce((sum, t) => sum + t.amountMinor, 0)).toBe(100_000);
  });
});
