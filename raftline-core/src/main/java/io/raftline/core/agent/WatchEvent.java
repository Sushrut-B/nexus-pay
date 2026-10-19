package io.raftline.core.agent;

import java.util.Arrays;
import java.util.Objects;

/**
 * Event notification delivered to reactive agent watchers when state is committed.
 */
public record WatchEvent(
        EventType type,
        String key,
        byte[] value,
        long version,
        long logIndex,
        long timestampEpochMs
) {
    public enum EventType {
        PUT,
        DELETE,
        SNAPSHOT_RESET
    }

    public WatchEvent {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(key, "key");
        value = (value != null) ? value : new byte[0];
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof WatchEvent that)) return false;
        return version == that.version &&
                logIndex == that.logIndex &&
                timestampEpochMs == that.timestampEpochMs &&
                type == that.type &&
                Objects.equals(key, that.key) &&
                Arrays.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(type, key, version, logIndex, timestampEpochMs);
        result = 31 * result + Arrays.hashCode(value);
        return result;
    }
}
