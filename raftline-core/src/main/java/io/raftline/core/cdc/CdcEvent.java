package io.raftline.core.cdc;

import java.util.Arrays;
import java.util.Objects;

/**
 * Immutable Change Data Capture (CDC) event representing a committed state transition.
 */
public record CdcEvent(
        long eventId,
        long logIndex,
        long logTerm,
        OperationType operation,
        String key,
        byte[] payload,
        long version,
        long timestampEpochMs
) {
    public enum OperationType {
        PUT,
        CAS,
        DELETE,
        OUTBOX
    }

    public CdcEvent {
        Objects.requireNonNull(operation, "operation");
        Objects.requireNonNull(key, "key");
        payload = (payload != null) ? payload : new byte[0];
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CdcEvent that)) return false;
        return eventId == that.eventId &&
                logIndex == that.logIndex &&
                logTerm == that.logTerm &&
                version == that.version &&
                timestampEpochMs == that.timestampEpochMs &&
                operation == that.operation &&
                Objects.equals(key, that.key) &&
                Arrays.equals(payload, that.payload);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(eventId, logIndex, logTerm, operation, key, version, timestampEpochMs);
        result = 31 * result + Arrays.hashCode(payload);
        return result;
    }
}
