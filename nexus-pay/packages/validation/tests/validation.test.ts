import { describe, expect, it } from "vitest";
import {
  onboardingSchema,
  normalizePhoneNumber,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
} from "@nexus/validation";

describe("normalizePhoneNumber", () => {
  it("normalises Indian mobile numbers", () => {
    expect(normalizePhoneNumber("98765 43210")).toBe("+919876543210");
    expect(normalizePhoneNumber("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhoneNumber("919876543210")).toBe("+919876543210");
  });

  it("preserves valid international numbers", () => {
    expect(normalizePhoneNumber("+1 415 555 0100")).toBe("+14155550100");
  });

  it("leaves invalid input unchanged for validation to reject", () => {
    expect(normalizePhoneNumber("12345")).toBe("12345");
  });
});

describe("passwordSchema", () => {
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Nexus!Wallet2026").success).toBe(true);
  });

  it.each([
    ["too short", "Ab!1"],
    ["no upper case", "nexus!wallet2026"],
    ["no lower case", "NEXUS!WALLET2026"],
    ["no number", "Nexus!Wallet"],
    ["no symbol", "NexusWallet2026"],
  ])("rejects a password with %s", (_reason, password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    fullName: "Aarav Sharma",
    email: "  AARAV@Example.COM ",
    phoneNumber: "98765 43210",
    username: "Aarav_01",
    password: "Nexus!Wallet2026",
    confirmPassword: "Nexus!Wallet2026",
  };

  it("normalises email, username and phone", () => {
    const result = registerSchema.parse(valid);
    expect(result.email).toBe("aarav@example.com");
    expect(result.username).toBe("aarav_01");
    expect(result.phoneNumber).toBe("+919876543210");
  });

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({
      ...valid,
      confirmPassword: "Nexus!Wallet2027",
    });
    expect(result.success).toBe(false);
  });

  it("rejects names containing unsupported characters", () => {
    const result = registerSchema.safeParse({ ...valid, fullName: "Aarav 123" });
    expect(result.success).toBe(false);
  });
});

describe("onboardingSchema", () => {
  it("accepts a supported currency and language", () => {
    const result = onboardingSchema.safeParse({
      displayName: "Aarav",
      username: "aarav_01",
      preferredCurrency: "INR",
      preferredLanguage: "en-IN",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported currency", () => {
    const result = onboardingSchema.safeParse({
      displayName: "Aarav",
      username: "aarav_01",
      preferredCurrency: "BTC",
      preferredLanguage: "en-IN",
    });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("rejects a short reset token", () => {
    const result = resetPasswordSchema.safeParse({
      token: "short",
      password: "Nexus!Wallet2026",
      confirmPassword: "Nexus!Wallet2026",
    });
    expect(result.success).toBe(false);
  });
});
