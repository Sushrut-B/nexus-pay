package io.raftline.storage.model;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Payload encoding for the atomic {@link CommandType#MULTI_PUT} command.
 *
 * <p>A MULTI_PUT carries an ordered list of key/value mutations plus an optional
 * <em>guard</em>. The guard is evaluated by the state machine <em>before</em> any mutation
 * is applied, while the state machine write lock is held. This makes "check the
 * idempotency table, then mutate" a single indivisible state machine transition, which is
 * what prevents two concurrent replicas from double-debiting a client.
 *
 * <p>Guard semantics:
 * <ul>
 *   <li>guard key absent -&gt; mutations are applied.</li>
 *   <li>guard key present and byte-identical to the guard value -&gt; the command is
 *       rejected as {@code IDEMPOTENT_DUPLICATE} (an identical request already executed).</li>
 *   <li>guard key present with a different value -&gt; the command is rejected as
 *       {@code IDEMPOTENCY_CONFLICT} (the key was reused with a different payload).</li>
 * </ul>
 *
 * <p>Because the guard evaluation happens inside the replicated state machine, the outcome
 * is deterministic on every replica: all nodes reach the same decision for the same log
 * index.
 */
public final class MultiPutPayload {

    /** Rejection code returned when the guard key exists with the same value. */
    public static final String REJECT_DUPLICATE = "IDEMPOTENT_DUPLICATE";
    /** Rejection code returned when the guard key exists with a different value. */
    public static final String REJECT_CONFLICT = "IDEMPOTENCY_CONFLICT";

    /** A single key/value mutation carried by the command. */
    public record Entry(String key, byte[] value) {}

    private final List<Entry> entries;
    private final String guardKey;
    private final byte[] guardValue;

    public MultiPutPayload(List<Entry> entries, String guardKey, byte[] guardValue) {
        this.entries = entries != null ? List.copyOf(entries) : List.of();
        this.guardKey = guardKey != null ? guardKey : "";
        this.guardValue = guardValue != null ? guardValue : new byte[0];
    }

    public List<Entry> entries() {
        return entries;
    }

    public String guardKey() {
        return guardKey;
    }

    public byte[] guardValue() {
        return guardValue;
    }

    public boolean hasGuard() {
        return !guardKey.isEmpty();
    }

    /**
     * Encodes this payload into the binary form embedded in {@link Command#getValue()}.
     */
    public byte[] encode() {
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (DataOutputStream out = new DataOutputStream(buffer)) {
                byte[] guardKeyBytes = guardKey.getBytes(StandardCharsets.UTF_8);
                out.writeInt(guardKeyBytes.length);
                out.write(guardKeyBytes);

                out.writeInt(guardValue.length);
                out.write(guardValue);

                out.writeInt(entries.size());
                for (Entry entry : entries) {
                    byte[] keyBytes = entry.key() != null ? entry.key().getBytes(StandardCharsets.UTF_8) : new byte[0];
                    byte[] valueBytes = entry.value() != null ? entry.value() : new byte[0];
                    out.writeInt(keyBytes.length);
                    out.write(keyBytes);
                    out.writeInt(valueBytes.length);
                    out.write(valueBytes);
                }
            }
            return buffer.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to encode MULTI_PUT payload", e);
        }
    }

    /**
     * Decodes the binary form produced by {@link #encode()}.
     */
    public static MultiPutPayload decode(byte[] bytes) throws IOException {
        if (bytes == null || bytes.length == 0) {
            return new MultiPutPayload(List.of(), "", new byte[0]);
        }
        try (DataInputStream in = new DataInputStream(new java.io.ByteArrayInputStream(bytes))) {
            int guardKeyLen = in.readInt();
            byte[] guardKeyBytes = new byte[guardKeyLen];
            in.readFully(guardKeyBytes);
            String guardKey = new String(guardKeyBytes, StandardCharsets.UTF_8);

            int guardValueLen = in.readInt();
            byte[] guardValue = new byte[guardValueLen];
            in.readFully(guardValue);

            int entryCount = in.readInt();
            List<Entry> entries = new ArrayList<>(Math.max(0, entryCount));
            for (int i = 0; i < entryCount; i++) {
                int keyLen = in.readInt();
                byte[] keyBytes = new byte[keyLen];
                in.readFully(keyBytes);
                int valueLen = in.readInt();
                byte[] valueBytes = new byte[valueLen];
                in.readFully(valueBytes);
                entries.add(new Entry(new String(keyBytes, StandardCharsets.UTF_8), valueBytes));
            }
            return new MultiPutPayload(entries, guardKey, guardValue);
        }
    }
}
