package io.raftline.core.shard;

import java.util.Objects;

/**
 * Key range boundary [startKey, endKey) for range-based Raft sharding.
 * An empty string ("") indicates unbounded beginning/end.
 */
public record KeyRange(String startKey, String endKey) {
    public static final KeyRange UNBOUNDED = new KeyRange("", "");

    public KeyRange {
        if (startKey == null) startKey = "";
        if (endKey == null) endKey = "";
    }

    /**
     * Checks whether the given key falls into the half-open range [startKey, endKey).
     */
    public boolean contains(String key) {
        Objects.requireNonNull(key, "key");
        if (!startKey.isEmpty() && key.compareTo(startKey) < 0) {
            return false;
        }
        if (!endKey.isEmpty() && key.compareTo(endKey) >= 0) {
            return false;
        }
        return true;
    }
}
