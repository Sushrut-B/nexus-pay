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

    /**
     * Splits this range at the given splitKey into two contiguous sub-ranges:
     * left: [startKey, splitKey)
     * right: [splitKey, endKey)
     */
    public KeyRange[] split(String splitKey) {
        Objects.requireNonNull(splitKey, "splitKey");
        if (!contains(splitKey)) {
            throw new IllegalArgumentException("Split key '" + splitKey + "' is not inside range [" + startKey + ", " + endKey + ")");
        }
        if (splitKey.equals(startKey)) {
            throw new IllegalArgumentException("Split key cannot be equal to startKey");
        }
        return new KeyRange[] {
                new KeyRange(this.startKey, splitKey),
                new KeyRange(splitKey, this.endKey)
        };
    }
}
