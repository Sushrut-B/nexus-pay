package io.raftline.core.shard.txn;

import java.util.Objects;

/**
 * State of a Two-Phase Commit (2PC) distributed transaction across Multi-Raft shards.
 */
public enum TxnState {
    PREPARING,
    PREPARED,
    COMMITTED,
    ABORTED
}
