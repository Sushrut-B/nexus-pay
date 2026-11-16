// ==============================================================================
// Nexus Clearing — Raftline Error Hierarchy
// ==============================================================================

export class RaftError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public leaderHint: string | null = null,
    public rawResponse?: unknown
  ) {
    super(message);
    this.name = "RaftError";
  }
}

export class NotLeaderError extends RaftError {
  constructor(leaderHint: string | null = null) {
    super(`Node is not the leader. Leader hint: ${leaderHint || "unknown"}`, 503, leaderHint);
    this.name = "NotLeaderError";
  }
}

export class QuorumUnavailableError extends RaftError {
  constructor(message: string = "Raft quorum is currently unreachable or in election") {
    super(message, 504);
    this.name = "QuorumUnavailableError";
  }
}

export class InsufficientFundsError extends RaftError {
  constructor(message: string = "Insufficient available balance to clear settlement") {
    super(message, 422);
    this.name = "InsufficientFundsError";
  }
}

