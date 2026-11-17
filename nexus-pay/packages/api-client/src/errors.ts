export type RaftlineErrorCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "NOT_LEADER"
  | "NOT_FOUND"
  | "BAD_RESPONSE"
  | "CONFLICT"
  | "AMBIGUOUS"
  | "PROVISIONING_FAILED"
  | "CONFIGURATION";

export class RaftlineError extends Error {
  readonly code: RaftlineErrorCode;
  readonly status: number | null;
  readonly leaderHint: string | null;
  readonly ambiguous: boolean;

  constructor(
    message: string,
    options: {
      code: RaftlineErrorCode;
      status?: number | null;
      leaderHint?: string | null;
      ambiguous?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "RaftlineError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.leaderHint = options.leaderHint ?? null;
    this.ambiguous = options.ambiguous ?? false;
  }
}

export function isNotLeaderError(error: unknown): error is RaftlineError {
  return error instanceof RaftlineError && error.code === "NOT_LEADER";
}

export function isAccountNotFoundError(error: unknown): error is RaftlineError {
  return error instanceof RaftlineError && error.code === "NOT_FOUND";
}

export function isAmbiguousError(error: unknown): error is RaftlineError {
  return error instanceof RaftlineError && error.ambiguous;
}

export function toSafeRaftlineError(error: unknown): RaftlineError {
  if (error instanceof RaftlineError) return error;
  return new RaftlineError("Raftline request failed", {
    code: "UNAVAILABLE",
    cause: error,
  });
}
