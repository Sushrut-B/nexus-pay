import { type RaftlineConfig, loadRaftlineConfig } from "./config";
import { RaftlinePaymentsClient } from "./accounts";
import { RaftlineHttp } from "./http";
import { LeaderLocator } from "./leader";

export interface CreateRaftlineClientOptions {
  config?: RaftlineConfig;
  env?: Record<string, string | undefined>;
}

export function createRaftlineClient(options: CreateRaftlineClientOptions = {}): RaftlinePaymentsClient {
  const config = options.config ?? loadRaftlineConfig(options.env);
  const http = new RaftlineHttp(config.timeoutMs, config.apiKey);
  const leader = new LeaderLocator(config.baseUrls, http, config.leaderCacheTtlMs);
  return new RaftlinePaymentsClient(config, http, leader);
}

export { RaftlinePaymentsClient, parseAccount } from "./accounts";
export type {
  EnsureAccountInput,
  EnsureAccountResult,
  FundAccountInput,
  FundAccountResult,
  RaftlineAccount,
  SettlePaymentInput,
} from "./accounts";
export { loadRaftlineConfig, RaftlineConfigurationError } from "./config";
export type { AccountCreateMode, RaftlineConfig } from "./config";
export {
  RaftlineError,
  isAccountNotFoundError,
  isAmbiguousError,
  isNotLeaderError,
  isTransientRaftlineError,
  toSafeRaftlineError,
} from "./errors";
export type { RaftlineErrorCode } from "./errors";
export {
  isRejectedReceipt,
  isSettledReceipt,
  parseTransactionReceipt,
  receiptMatches,
} from "./receipts";
export type { RaftlineTransactionReceipt } from "./receipts";
export { LeaderLocator } from "./leader";
export type { ClusterStatus, LeaderLocation } from "./leader";
export type { HttpTransport, RaftlineHttpResponse } from "./http";
