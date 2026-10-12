package io.raftline.storage.state;

import java.util.Arrays;

public final class ApplyResult {
    private final boolean success;
    private final byte[] value;
    private final String error;
    private final boolean duplicate;

    private ApplyResult(boolean success, byte[] value, String error, boolean duplicate) {
        this.success = success;
        this.value = value != null ? value : new byte[0];
        this.error = error;
        this.duplicate = duplicate;
    }

    public static ApplyResult ok() {
        return new ApplyResult(true, new byte[0], null, false);
    }

    public static ApplyResult ok(byte[] value) {
        return new ApplyResult(true, value, null, false);
    }

    public static ApplyResult duplicate(byte[] cachedValue) {
        return new ApplyResult(true, cachedValue, null, true);
    }

    public static ApplyResult error(String error) {
        return new ApplyResult(false, new byte[0], error, false);
    }

    public boolean isSuccess() {
        return success;
    }

    public byte[] getValue() {
        return value;
    }

    public String getError() {
        return error;
    }

    public boolean isDuplicate() {
        return duplicate;
    }

    @Override
    public String toString() {
        return "ApplyResult{" +
                "success=" + success +
                ", duplicate=" + duplicate +
                ", valueLen=" + (value != null ? value.length : 0) +
                ", error='" + error + '\'' +
                '}';
    }
}
