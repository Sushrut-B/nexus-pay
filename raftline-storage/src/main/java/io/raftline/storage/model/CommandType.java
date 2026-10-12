package io.raftline.storage.model;

public enum CommandType {
    PUT((byte) 1),
    DELETE((byte) 2),
    NOOP((byte) 3);

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
