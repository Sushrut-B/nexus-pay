import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_REMEMBER_ME_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_DEV_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().trim().default("Nexus Pay <no-reply@nexuspay.local>"),
  RAFTLINE_BASE_URLS: z.string().trim().optional(),
  RAFTLINE_NODE_1_URL: z.string().trim().optional(),
  RAFTLINE_NODE_2_URL: z.string().trim().optional(),
  RAFTLINE_NODE_3_URL: z.string().trim().optional(),
  RAFTLINE_NODE_4_URL: z.string().trim().optional(),
  RAFTLINE_NODE_5_URL: z.string().trim().optional(),
  RAFTLINE_TENANT_ID: z.string().trim().default("nexuspay"),
  RAFTLINE_API_KEY: z.string().trim().optional(),
  RAFTLINE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  RAFTLINE_SETTLEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  RAFTLINE_LEADER_CACHE_TTL_MS: z.coerce.number().int().positive().default(5000),
  RAFTLINE_ACCOUNT_CREATE_MODE: z.enum(["auto", "official", "kv"]).default("auto"),
  RECIPIENT_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(24 * 60).default(15),
  PAYMENT_RECONCILIATION_MIN_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(300)
    .default(3),
});

let cached: z.infer<typeof envSchema> | null = null;

export function getServerEnv() {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    const message = Object.entries(fields)
      .map(([field, errors]) => `${field}: ${errors?.join(", ")}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${message}`);
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getServerEnv().NODE_ENV === "production";
}

export function appBaseUrl(): URL {
  return new URL(getServerEnv().APP_URL);
}

export function isSecureCookie(): boolean {
  return appBaseUrl().protocol === "https:" || isProduction();
}
