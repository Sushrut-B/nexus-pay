package io.raftline.api.redis;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * RESP (REdis Serialization Protocol) frame models.
 * Supports:
 * - Simple Strings (+OK\r\n)
 * - Errors (-ERR ...\r\n)
 * - Integers (:100\r\n)
 * - Bulk Strings ($4\r\ntest\r\n or $-1\r\n for null)
 * - Arrays (*2\r\n... or *-1\r\n for null)
 */
public interface RespFrame {

    byte[] encode();

    record SimpleString(String value) implements RespFrame {
        public static final SimpleString OK = new SimpleString("OK");
        public static final SimpleString PONG = new SimpleString("PONG");

        @Override
        public byte[] encode() {
            return ("+" + value + "\r\n").getBytes(StandardCharsets.UTF_8);
        }
    }

    record Error(String message) implements RespFrame {
        @Override
        public byte[] encode() {
            return ("-ERR " + message + "\r\n").getBytes(StandardCharsets.UTF_8);
        }
    }

    record IntegerFrame(long value) implements RespFrame {
        @Override
        public byte[] encode() {
            return (":" + value + "\r\n").getBytes(StandardCharsets.UTF_8);
        }
    }

    record BulkString(byte[] data) implements RespFrame {
        public static final BulkString NULL = new BulkString(null);

        public static BulkString of(String str) {
            return str == null ? NULL : new BulkString(str.getBytes(StandardCharsets.UTF_8));
        }

        public String asString() {
            return data == null ? null : new String(data, StandardCharsets.UTF_8);
        }

        @Override
        public byte[] encode() {
            if (data == null) {
                return "$-1\r\n".getBytes(StandardCharsets.UTF_8);
            }
            byte[] prefix = ("$" + data.length + "\r\n").getBytes(StandardCharsets.UTF_8);
            byte[] result = new byte[prefix.length + data.length + 2];
            System.arraycopy(prefix, 0, result, 0, prefix.length);
            System.arraycopy(data, 0, result, prefix.length, data.length);
            result[result.length - 2] = '\r';
            result[result.length - 1] = '\n';
            return result;
        }
    }

    record Array(List<RespFrame> elements) implements RespFrame {
        public static final Array NULL = new Array(null);
        public static final Array EMPTY = new Array(Collections.emptyList());

        public static Array of(RespFrame... items) {
            return new Array(List.of(items));
        }

        @Override
        public byte[] encode() {
            if (elements == null) {
                return "*-1\r\n".getBytes(StandardCharsets.UTF_8);
            }
            StringBuilder sb = new StringBuilder();
            sb.append("*").append(elements.size()).append("\r\n");
            byte[] header = sb.toString().getBytes(StandardCharsets.UTF_8);

            List<byte[]> encodedElements = new ArrayList<>(elements.size());
            int totalLen = header.length;
            for (RespFrame el : elements) {
                byte[] enc = el.encode();
                encodedElements.add(enc);
                totalLen += enc.length;
            }

            byte[] out = new byte[totalLen];
            System.arraycopy(header, 0, out, 0, header.length);
            int pos = header.length;
            for (byte[] enc : encodedElements) {
                System.arraycopy(enc, 0, out, pos, enc.length);
                pos += enc.length;
            }
            return out;
        }
    }
}
