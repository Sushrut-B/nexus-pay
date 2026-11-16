package io.raftline.storage.model;

public enum CommandType {
    PUT((byte) 1),
    DELETE((byte) 2),
    NOOP((byte) 3),
    CAS((byte) 4),
    /**
     * Atomic multi-key mutation with an optional idempotency guard. All key/value
     * mutations and the guard evaluation happen in a single state machine apply, so
     * the check-then-act sequence is indivisible across replicas.
     */
    MULTI_PUT((byte) 5);

    private final byte code;

    CommandType(byte code) {
        this.code = code;
    }

    public byte getCode() {
        return code;
    }

    public static CommandType fromCode(byte code) {
        for (CommandType type : values()) {
            if (type.code == code) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown CommandType code: " + code);
    }
}
