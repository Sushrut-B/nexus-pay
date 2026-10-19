package io.raftline.storage.state;

import java.util.Arrays;
import java.util.Objects;

/**
 * Immutable record containing a stored value and its monotonic consensus version number.
 */
public record VersionedValue(byte[] value, long version) {
    public VersionedValue(byte[] value, long version) {
        this.value = value != null ? value : new byte[0];
        this.version = version;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof VersionedValue that)) return false;
        return version == that.version && Arrays.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(version);
        result = 31 * result + Arrays.hashCode(value);
        return result;
    }
}
