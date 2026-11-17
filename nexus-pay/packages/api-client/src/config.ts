export type AccountCreateMode = "auto" | "official" | "kv";

export interface RaftlineConfig {
  baseUrls: string[];
  tenantId: string;
  apiKey: string | null;
  timeoutMs: number;
  /** Settlement and funding can legally take longer than a read request. */
  settlementTimeoutMs: number;
  leaderCacheTtlMs: number;
  accountCreateMode: AccountCreateMode;
}

const DEFAULT_BASE_URLS = [
  "http://localhost:8001",
  "http://localhost:8002",
  "http://localhost:8003",
  "http://localhost:8004",
  "http://localhost:8005",
];

const SAFE_TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

export class RaftlineConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaftlineConfigurationError";
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RaftlineConfigurationError(`Expected a positive integer, received "${value}"`);
  }
  return parsed;
}

function resolveBaseUrls(env: Record<string, string | undefined>): string[] {
  if (env.RAFTLINE_BASE_URLS) {
    return env.RAFTLINE_BASE_URLS.split(",");
  }

  const perNodeUrls = [1, 2, 3, 4, 5]
    .map((index) => env[`RAFTLINE_NODE_${index}_URL`])
    .filter((url): url is string => Boolean(url?.trim()));

  return perNodeUrls.length > 0 ? perNodeUrls : DEFAULT_BASE_URLS;
}

export function loadRaftlineConfig(
  env: Record<string, string | undefined> = process.env,
): RaftlineConfig {
  const rawUrls = resolveBaseUrls(env);
  const baseUrls = rawUrls
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .filter((url) => /^https?:\/\/[^/]+$/.test(url));

  if (baseUrls.length === 0) {
    throw new RaftlineConfigurationError("RAFTLINE_BASE_URLS must contain at least one HTTP URL");
  }

  const tenantId = (env.RAFTLINE_TENANT_ID ?? "nexuspay").trim();
  if (!SAFE_TENANT_PATTERN.test(tenantId)) {
    throw new RaftlineConfigurationError(
      "RAFTLINE_TENANT_ID must be 1-64 characters of letters, numbers, underscores or hyphens",
    );
  }

  const rawMode = (
    env.RAFTLINE_ACCOUNT_CREATE_MODE ??
    env.RAFTLINE_ACCOUNT_CREATION_MODE ??
    "auto"
  )
    .trim()
    .toLowerCase();
  const modeAliases: Record<string, AccountCreateMode> = {
    auto: "auto",
    official: "official",
    api: "official",
    kv: "kv",
    kv_compat: "kv",
  };
  const mode = modeAliases[rawMode];
  if (!mode) {
    throw new RaftlineConfigurationError(
      'RAFTLINE_ACCOUNT_CREATE_MODE must be "auto", "official" or "kv"',
    );
  }

  return {
    baseUrls,
    tenantId,
    apiKey: env.RAFTLINE_API_KEY?.trim() || null,
    timeoutMs: parsePositiveInteger(
      env.RAFTLINE_TIMEOUT_MS ?? env.RAFTLINE_REQUEST_TIMEOUT_MS,
      8000,
    ),
    settlementTimeoutMs: parsePositiveInteger(
      env.RAFTLINE_SETTLEMENT_TIMEOUT_MS,
      25_000,
    ),
    leaderCacheTtlMs: parsePositiveInteger(env.RAFTLINE_LEADER_CACHE_TTL_MS, 5000),
    accountCreateMode: mode,
  };
}

export function assertSafeAccountId(accountId: string): void {
  if (!SAFE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new RaftlineConfigurationError(
      "Account id must be 1-80 characters of letters, numbers, dots, underscores or hyphens",
    );
  }
}

const SAFE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/;

export function assertSafeIdempotencyKey(key: string): void {
  if (!SAFE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new RaftlineConfigurationError(
      "Idempotency key must be 8-80 characters of letters, numbers, dots, colons, underscores or hyphens",
    );
  }
}
