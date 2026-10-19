package io.raftline.storage.model;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;

/**
 * State machine command representing a mutation or heartbeat no-op.
 * Includes clientId and sequenceNumber for idempotency.
 */
public final class Command {
    private final CommandType type;
    private final String key;
    private final byte[] value;
    private final String clientId;
    private final long sequenceNumber;
    private final long expectedVersion;

    public Command(CommandType type, String key, byte[] value, String clientId, long sequenceNumber) {
        this(type, key, value, clientId, sequenceNumber, -1L);
    }

    public Command(CommandType type, String key, byte[] value, String clientId, long sequenceNumber, long expectedVersion) {
        this.type = Objects.requireNonNull(type, "type cannot be null");
        this.key = key;
        this.value = value != null ? value : new byte[0];
        this.clientId = clientId != null ? clientId : "";
        this.sequenceNumber = sequenceNumber;
        this.expectedVersion = expectedVersion;
    }

    public static Command put(String key, byte[] value, String clientId, long sequenceNumber) {
        return new Command(CommandType.PUT, key, value, clientId, sequenceNumber, -1L);
    }

    public static Command put(String key, byte[] value) {
        return new Command(CommandType.PUT, key, value, "", 0L, -1L);
    }

    public static Command delete(String key, String clientId, long sequenceNumber) {
        return new Command(CommandType.DELETE, key, new byte[0], clientId, sequenceNumber, -1L);
    }

    public static Command delete(String key) {
        return new Command(CommandType.DELETE, key, new byte[0], "", 0L, -1L);
    }

    public static Command cas(String key, long expectedVersion, byte[] newValue, String clientId, long sequenceNumber) {
        return new Command(CommandType.CAS, key, newValue, clientId, sequenceNumber, expectedVersion);
    }

    public static Command noop() {
        return new Command(CommandType.NOOP, "", new byte[0], "", 0L, -1L);
    }

    public CommandType getType() {
        return type;
    }

    public String getKey() {
        return key;
    }

    public byte[] getValue() {
        return value;
    }

    public String getClientId() {
        return clientId;
    }

    public long getSequenceNumber() {
        return sequenceNumber;
    }

    public long getExpectedVersion() {
        return expectedVersion;
    }

    public byte[] serialize() {
        byte[] keyBytes = (key != null) ? key.getBytes(StandardCharsets.UTF_8) : new byte[0];
        byte[] clientBytes = clientId.getBytes(StandardCharsets.UTF_8);

        // Format:
        // [1 byte: type]
        // [8 bytes: sequenceNumber]
        // [8 bytes: expectedVersion]
        // [4 bytes: clientId length] + clientBytes
        // [4 bytes: key length] + keyBytes
        // [4 bytes: value length] + value
        int totalSize = 1 + 8 + 8 + 4 + clientBytes.length + 4 + keyBytes.length + 4 + value.length;
        ByteBuffer buffer = ByteBuffer.allocate(totalSize);

        buffer.put(type.getCode());
        buffer.putLong(sequenceNumber);
        buffer.putLong(expectedVersion);

        buffer.putInt(clientBytes.length);
        buffer.put(clientBytes);

        buffer.putInt(keyBytes.length);
        buffer.put(keyBytes);

        buffer.putInt(value.length);
        buffer.put(value);

        return buffer.array();
    }

    public static Command deserialize(ByteBuffer buffer) {
        byte typeCode = buffer.get();
        CommandType type = CommandType.fromCode(typeCode);
        long sequenceNumber = buffer.getLong();
        long expectedVersion = buffer.getLong();

        int clientLen = buffer.getInt();
        byte[] clientBytes = new byte[clientLen];
        buffer.get(clientBytes);
        String clientId = new String(clientBytes, StandardCharsets.UTF_8);

        int keyLen = buffer.getInt();
        byte[] keyBytes = new byte[keyLen];
        buffer.get(keyBytes);
        String key = new String(keyBytes, StandardCharsets.UTF_8);

        int valLen = buffer.getInt();
        byte[] valBytes = new byte[valLen];
        buffer.get(valBytes);

        return new Command(type, key, valBytes, clientId, sequenceNumber, expectedVersion);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Command command = (Command) o;
        return sequenceNumber == command.sequenceNumber &&
                expectedVersion == command.expectedVersion &&
                type == command.type &&
                Objects.equals(key, command.key) &&
                Arrays.equals(value, command.value) &&
                Objects.equals(clientId, command.clientId);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(type, key, clientId, sequenceNumber, expectedVersion);
        result = 31 * result + Arrays.hashCode(value);
        return result;
    }

    @Override
    public String toString() {
        return "Command{" +
                "type=" + type +
                ", key='" + key + '\'' +
                ", expectedVersion=" + expectedVersion +
                ", valueLen=" + (value != null ? value.length : 0) +
                ", clientId='" + clientId + '\'' +
                ", sequenceNumber=" + sequenceNumber +
                '}';
    }
}
