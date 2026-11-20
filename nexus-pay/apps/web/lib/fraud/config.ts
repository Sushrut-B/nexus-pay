/** Release 13 — versioned, configurable fraud configuration defaults. */

export const RULESET_VERSION = "r13-rules-v1";
export const FEATURE_VERSION = "r13-features-v1";
export const MODEL_VERSION = "r13-rules-baseline-v1";
export const DEFAULT_POLICY_CODE = "default";

export const DEFAULT_THRESHOLDS = { lowMax: 24, moderateMax: 49, highMax: 74 };

export const CLASSIFICATION_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type Classification = (typeof CLASSIFICATION_ORDER)[number];

export const DEFAULT_ACTION_MAP: Record<Classification, "ALLOW" | "ALLOW_WITH_MONITORING" | "REQUIRE_STEP_UP_AUTHENTICATION" | "REQUIRE_CUSTOMER_CONFIRMATION" | "HOLD_FOR_MANUAL_REVIEW" | "BLOCK_INITIATION"> = {
  LOW: "ALLOW",
  MODERATE: "ALLOW_WITH_MONITORING",
  HIGH: "REQUIRE_CUSTOMER_CONFIRMATION",
  CRITICAL: "HOLD_FOR_MANUAL_REVIEW",
};

/** Keys that must never be persisted in security event metadata. */
export const SENSITIVE_METADATA_KEYS = new Set([
  "password", "passwordhash", "currentpassword", "newpassword", "otp", "pin", "upin",
  "accesstoken", "refreshtoken", "sessiontoken", "token", "secret", "apikey", "authorization",
  "cardnumber", "card", "cvv", "accountnumber", "iframes", "cookie", "csrf", "rawbody",
]);

export function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""))) continue;
    if (item && typeof item === "object") out[key] = sanitizeMetadata(item, depth + 1);
    else if (typeof item === "string") out[key] = item.slice(0, 300);
    else if (typeof item === "number" || typeof item === "boolean") out[key] = item;
  }
  return out;
}
