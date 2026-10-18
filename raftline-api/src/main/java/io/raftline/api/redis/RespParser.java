package io.raftline.api.redis;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Streaming parser for Redis RESP wire protocol.
 */
public class RespParser {

    public static RespFrame parse(InputStream in) throws IOException {
        int b = in.read();
        if (b == -1) {
            return null; // Stream closed
        }

        return switch ((char) b) {
            case '+' -> new RespFrame.SimpleString(readLine(in));
            case '-' -> new RespFrame.Error(readLine(in));
            case ':' -> new RespFrame.IntegerFrame(Long.parseLong(readLine(in)));
            case '$' -> parseBulkString(in);
            case '*' -> parseArray(in);
            default -> {
                // Inline command fallback (e.g., raw text "PING\r\n")
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                buf.write(b);
                while (true) {
                    int next = in.read();
                    if (next == -1 || next == '\n') break;
                    if (next != '\r') buf.write(next);
                }
                String line = buf.toString(StandardCharsets.UTF_8).trim();
                if (line.isEmpty()) {
                    yield null;
                }
                String[] parts = line.split("\\s+");
                List<RespFrame> items = new ArrayList<>(parts.length);
                for (String part : parts) {
                    items.add(RespFrame.BulkString.of(part));
                }
                yield new RespFrame.Array(items);
            }
        };
    }

    private static RespFrame parseBulkString(InputStream in) throws IOException {
        long length = Long.parseLong(readLine(in));
        if (length == -1) {
            return RespFrame.BulkString.NULL;
        }
        if (length > 512 * 1024 * 1024) {
            throw new IOException("Bulk string exceeds 512MB limit: " + length);
        }

        byte[] payload = readFully(in, (int) length);
        // Expect trailing \r\n
        int cr = in.read();
        int lf = in.read();
        if (cr != '\r' || lf != '\n') {
            throw new IOException("Malformed bulk string trailing CRLF");
        }
        return new RespFrame.BulkString(payload);
    }

    private static RespFrame parseArray(InputStream in) throws IOException {
        long count = Long.parseLong(readLine(in));
        if (count == -1) {
            return RespFrame.Array.NULL;
        }
        List<RespFrame> elements = new ArrayList<>((int) count);
        for (int i = 0; i < count; i++) {
            RespFrame el = parse(in);
            if (el == null) {
                throw new EOFException("Unexpected EOF while parsing RESP array at index " + i);
            }
            elements.add(el);
        }
        return new RespFrame.Array(elements);
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int prev = -1;
        while (true) {
            int b = in.read();
            if (b == -1) {
                throw new EOFException("Unexpected EOF while reading line");
            }
            if (prev == '\r' && b == '\n') {
                byte[] raw = buf.toByteArray();
                // strip the '\r'
                return new String(raw, 0, raw.length - 1, StandardCharsets.UTF_8);
            }
            buf.write(b);
            prev = b;
        }
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] data = new byte[length];
        int readTotal = 0;
        while (readTotal < length) {
            int count = in.read(data, readTotal, length - readTotal);
            if (count == -1) {
                throw new EOFException("Unexpected EOF while reading payload (" + readTotal + "/" + length + ")");
            }
            readTotal += count;
        }
        return data;
    }
}
