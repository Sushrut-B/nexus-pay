package io.raftline.core.shard.txn;

import io.raftline.storage.model.Command;

import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Representation of a multi-shard transactional context in a 2PC workflow.
 */
public record TxnContext(
        String txnId,
        Map<String, byte[]> writes,
        Set<String> involvedShards,
        long createTimeNanos
) {
    public TxnContext {
        Objects.requireNonNull(txnId, "txnId");
        Objects.requireNonNull(writes, "writes");
        Objects.requireNonNull(involvedShards, "involvedShards");
    }
}
