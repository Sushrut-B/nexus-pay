package io.raftline.storage.model;

import java.nio.ByteBuffer;
import java.util.Objects;
import java.util.zip.CRC32;

/**
 * An immutable Raft log entry containing an index, term, and state machine command.
 * Supports binary serialization with CRC32 checksum verification.
 */
public final class LogEntry {
    private final long index;
    private final long term;
    private final Command command;

    public LogEntry(long index, long term, Command command) {
        if (index <= 0) {
            throw new IllegalArgumentException("Log index must be positive (1-based), got: " + index);
        }
        if (term < 0) {
            throw new IllegalArgumentException("Log term cannot be negative, got: " + term);
        }
        this.index = index;
        this.term = term;
        this.command = Objects.requireNonNull(command, "command cannot be null");
    }

    public long getIndex() {
        return index;
    }

    public long getTerm() {
        return term;
    }

    public Command getCommand() {
        return command;
    }

    /**
     * Serializes this entry with CRC32 framing.
     * Binary Format:
     * [4 bytes: CRC32 checksum of data]
     * [4 bytes: payload length]
     * [8 bytes: log index]
     * [8 bytes: term]
     * [N bytes: command serialized bytes]
     */
    public byte[] serialize() {
        byte[] commandBytes = command.serialize();
        int payloadLength = 8 + 8 + commandBytes.length; // index + term + commandBytes

        ByteBuffer payloadBuffer = ByteBuffer.allocate(payloadLength);
        payloadBuffer.putLong(index);
        payloadBuffer.putLong(term);
        payloadBuffer.put(commandBytes);
        byte[] payload = payloadBuffer.array();

        CRC32 crc32 = new CRC32();
        crc32.update(payload);
        int checksum = (int) crc32.getValue();

        ByteBuffer framedBuffer = ByteBuffer.allocate(4 + 4 + payloadLength);
        framedBuffer.putInt(checksum);
        framedBuffer.putInt(payloadLength);
        framedBuffer.put(payload);

        return framedBuffer.array();
    }

    /**
     * Deserializes a LogEntry from a framed buffer and validates CRC32.
     * Returns null if buffer does not contain enough bytes for header.
     * Throws CorruptedLogException if CRC32 check fails.
     */
    public static LogEntry deserialize(ByteBuffer buffer) {
        if (buffer.remaining() < 8) {
            throw new IllegalArgumentException("Buffer too small for LogEntry frame header");
        }

        int expectedChecksum = buffer.getInt();
        int payloadLength = buffer.getInt();

        if (payloadLength < 16) {
            throw new IllegalStateException("Corrupt log entry: invalid payload length " + payloadLength);
        }

        if (buffer.remaining() < payloadLength) {
            throw new IllegalArgumentException("Buffer incomplete: expected " + payloadLength + " bytes, available " + buffer.remaining());
        }

        byte[] payload = new byte[payloadLength];
        buffer.get(payload);

        CRC32 crc32 = new CRC32();
        crc32.update(payload);
        int actualChecksum = (int) crc32.getValue();

        if (expectedChecksum != actualChecksum) {
            throw new IllegalStateException("CRC32 mismatch! Expected: " + expectedChecksum + ", actual: " + actualChecksum);
        }

        ByteBuffer payloadBuffer = ByteBuffer.wrap(payload);
        long index = payloadBuffer.getLong();
        long term = payloadBuffer.getLong();
        Command command = Command.deserialize(payloadBuffer);

        return new LogEntry(index, term, command);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LogEntry logEntry = (LogEntry) o;
        return index == logEntry.index &&
                term == logEntry.term &&
                Objects.equals(command, logEntry.command);
    }

    @Override
    public int hashCode() {
        return Objects.hash(index, term, command);
    }

    @Override
    public String toString() {
        return "LogEntry{" +
                "index=" + index +
                ", term=" + term +
                ", command=" + command +
                '}';
    }
}
