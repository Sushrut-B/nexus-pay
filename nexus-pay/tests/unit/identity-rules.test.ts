import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { PRIVACY_PURPOSES } from "../../packages/shared-types/src/identity";
import { passwordSchema, dataDeletionRequestSchemaV2 } from "../../packages/validation/src/index";

describe("Release 20 — identity and privacy rules", () => {
  it("uses RFC 6238 TOTP with a 6-digit, 30-second code", () => {
    authenticator.options = { window: 1, digits: 6, step: 30 };
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(authenticator.check(code, secret)).toBe(true);
    expect(authenticator.check("000000", secret)).toBe(false);
  });

  it("keeps required privacy purposes non-withdrawable", () => {
    const required = PRIVACY_PURPOSES.filter((purpose) => purpose.required);
    expect(required.map((purpose) => purpose.code)).toEqual(
      expect.arrayContaining(["ACCOUNT_OPERATION", "SECURITY_FRAUD_PREVENTION"]),
    );
    expect(PRIVACY_PURPOSES.some((purpose) => purpose.code === "PRODUCT_ANALYTICS")).toBe(true);
  });

  it("enforces the documented password policy", () => {
    expect(passwordSchema.safeParse("StrongPass!2026").success).toBe(true);
    expect(passwordSchema.safeParse("weak").success).toBe(false);
    expect(passwordSchema.safeParse("alllowercase1!").success).toBe(false);
  });

  it("requires explicit deletion confirmation", () => {
    const key = "delete-request-0001";
    expect(dataDeletionRequestSchemaV2.safeParse({
      reason: "No longer using the account", confirmation: "DELETE_MY_ACCOUNT_DATA", idempotencyKey: key,
    }).success).toBe(true);
    expect(dataDeletionRequestSchemaV2.safeParse({
      reason: "No longer using the account", confirmation: "NO", idempotencyKey: key,
    }).success).toBe(false);
  });
});
