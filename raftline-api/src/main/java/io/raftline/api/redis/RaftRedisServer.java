package io.raftline.api.redis;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.NotLeaderException;
import io.raftline.core.RaftNode;
import io.raftline.core.shard.MultiRaftManager;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * High-performance TCP Server speaking Redis Wire Protocol (RESP).
 * Supports core Strings, Hashes (HSET/HGET/HDEL/HGETALL/HLEN),
 * Sets (SADD/SMEMBERS/SREM/SCARD/SISMEMBER), and Lists/Queues (LPUSH/RPUSH/LPOP/RPOP/LLEN/LRANGE).
 */
public class RaftRedisServer implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(RaftRedisServer.class);
    private static final ObjectMapper json = new ObjectMapper();

    private final int port;
    private final RaftNode raftNode;
    private final MultiRaftManager multiRaftManager;
    private final String authPassword;
    private final ServerSocket serverSocket;
    private final ExecutorService clientPool;
    private volatile boolean running = true;

    // Optional TTL expiration store (key -> expiration timestamp epoch millis)
    private final Map<String, Long> keyTtlMap = new ConcurrentHashMap<>();

    public RaftRedisServer(int port, RaftNode raftNode) throws IOException {
        this(port, raftNode, null, null);
    }

    public RaftRedisServer(int port, RaftNode raftNode, MultiRaftManager multiRaftManager, String authPassword) throws IOException {
        this.port = port;
        this.raftNode = raftNode;
        this.multiRaftManager = multiRaftManager;
        this.authPassword = (authPassword != null && !authPassword.isBlank()) ? authPassword.trim() : null;
        this.serverSocket = new ServerSocket(port);
        this.clientPool = Executors.newCachedThreadPool();

        log.info("Raftline Redis RESP Server bound on port {}", serverSocket.getLocalPort());
    }

    public void start() {
        clientPool.submit(this::acceptLoop);
    }

    private void acceptLoop() {
        while (running && !serverSocket.isClosed()) {
            try {
                Socket socket = serverSocket.accept();
                socket.setTcpNoDelay(true);
                clientPool.submit(() -> handleClient(socket));
            } catch (IOException e) {
                if (!running) break;
                log.warn("Error accepting Redis socket: {}", e.getMessage());
            }
        }
    }

    private void handleClient(Socket socket) {
        boolean authenticated = (authPassword == null);
        try (socket;
             BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
             BufferedOutputStream out = new BufferedOutputStream(socket.getOutputStream())) {

            while (running && !socket.isClosed()) {
                RespFrame frame = RespParser.parse(in);
                if (frame == null) {
                    break; // Client disconnected
                }

                if (!(frame instanceof RespFrame.Array array) || array.elements() == null || array.elements().isEmpty()) {
                    writeFrame(out, new RespFrame.Error("ERR invalid command format"));
                    continue;
                }

                List<RespFrame> items = array.elements();
                String cmd = extractString(items.get(0));
                if (cmd == null) {
                    writeFrame(out, new RespFrame.Error("ERR unknown command"));
                    continue;
                }
                cmd = cmd.toUpperCase();

                // Authentication check
                if (!authenticated && !"AUTH".equals(cmd) && !"QUIT".equals(cmd)) {
                    writeFrame(out, new RespFrame.Error("NOAUTH Authentication required."));
                    continue;
                }

                RespFrame response = executeCommand(cmd, items, authenticated);
                if ("AUTH".equals(cmd) && response instanceof RespFrame.SimpleString) {
                    authenticated = true;
                }

                writeFrame(out, response);

                if ("QUIT".equals(cmd)) {
                    break;
                }
            }
        } catch (IOException e) {
            log.debug("Redis client disconnected: {}", e.getMessage());
        } catch (Exception e) {
            log.error("Unexpected Redis handler error", e);
        }
    }

    private RespFrame executeCommand(String cmd, List<RespFrame> items, boolean authenticated) {
        try {
            switch (cmd) {
                // Connection & Info Commands
                case "PING" -> {
                    if (items.size() > 1) {
                        return RespFrame.BulkString.of(extractString(items.get(1)));
                    }
                    return RespFrame.SimpleString.PONG;
                }
                case "AUTH" -> {
                    if (items.size() < 2) {
                        return new RespFrame.Error("wrong number of arguments for 'auth' command");
                    }
                    String pwd = extractString(items.get(1));
                    if (authPassword != null && authPassword.equals(pwd)) {
                        return RespFrame.SimpleString.OK;
                    }
                    return new RespFrame.Error("WRONGPASS invalid username-password pair or token");
                }
                case "ECHO" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'echo'");
                    return RespFrame.BulkString.of(extractString(items.get(1)));
                }

                // Core String Commands
                case "SET" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'set' command");
                    String key = extractString(items.get(1));
                    String val = extractString(items.get(2));

                    Long ttlSeconds = null;
                    if (items.size() >= 5) {
                        String ex = extractString(items.get(3));
                        if ("EX".equalsIgnoreCase(ex)) {
                            ttlSeconds = Long.parseLong(extractString(items.get(4)));
                        }
                    }

                    executeRaftWrite(Command.put(key, val.getBytes(StandardCharsets.UTF_8)));
                    if (ttlSeconds != null && ttlSeconds > 0) {
                        keyTtlMap.put(key, System.currentTimeMillis() + (ttlSeconds * 1000));
                    } else {
                        keyTtlMap.remove(key);
                    }
                    return RespFrame.SimpleString.OK;
                }
                case "GET" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'get' command");
                    String key = extractString(items.get(1));

                    if (isExpired(key)) {
                        executeRaftWrite(Command.delete(key));
                        keyTtlMap.remove(key);
                        return RespFrame.BulkString.NULL;
                    }

                    byte[] val = executeRaftRead(key);
                    return (val == null) ? RespFrame.BulkString.NULL : new RespFrame.BulkString(val);
                }
                case "DEL" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'del' command");
                    long deletedCount = 0;
                    for (int i = 1; i < items.size(); i++) {
                        String k = extractString(items.get(i));
                        byte[] existing = executeRaftRead(k);
                        if (existing != null) {
                            executeRaftWrite(Command.delete(k));
                            keyTtlMap.remove(k);
                            deletedCount++;
                        }
                    }
                    return new RespFrame.IntegerFrame(deletedCount);
                }
                case "EXISTS" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'exists' command");
                    long existsCount = 0;
                    for (int i = 1; i < items.size(); i++) {
                        String k = extractString(items.get(i));
                        if (!isExpired(k) && executeRaftRead(k) != null) {
                            existsCount++;
                        }
                    }
                    return new RespFrame.IntegerFrame(existsCount);
                }
                case "MGET" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'mget' command");
                    List<RespFrame> results = new ArrayList<>(items.size() - 1);
                    for (int i = 1; i < items.size(); i++) {
                        String k = extractString(items.get(i));
                        if (isExpired(k)) {
                            results.add(RespFrame.BulkString.NULL);
                        } else {
                            byte[] v = executeRaftRead(k);
                            results.add(v == null ? RespFrame.BulkString.NULL : new RespFrame.BulkString(v));
                        }
                    }
                    return new RespFrame.Array(results);
                }
                case "MSET" -> {
                    if (items.size() < 3 || (items.size() - 1) % 2 != 0) {
                        return new RespFrame.Error("wrong number of arguments for 'mset' command");
                    }
                    List<Command> batch = new ArrayList<>();
                    long baseSeq = System.nanoTime();
                    String clientId = UUID.randomUUID().toString();
                    int offset = 0;
                    for (int i = 1; i < items.size(); i += 2) {
                        String k = extractString(items.get(i));
                        String v = extractString(items.get(i + 1));
                        batch.add(Command.put(k, v.getBytes(StandardCharsets.UTF_8), clientId, baseSeq + offset));
                        keyTtlMap.remove(k);
                        offset++;
                    }
                    executeRaftBatch(batch);
                    return RespFrame.SimpleString.OK;
                }
                case "INCR" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'incr' command");
                    String key = extractString(items.get(1));
                    return incrementBy(key, 1);
                }
                case "INCRBY" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'incrby' command");
                    String key = extractString(items.get(1));
                    long delta = Long.parseLong(extractString(items.get(2)));
                    return incrementBy(key, delta);
                }
                case "TTL" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'ttl' command");
                    String key = extractString(items.get(1));
                    Long exp = keyTtlMap.get(key);
                    if (exp == null) {
                        byte[] v = executeRaftRead(key);
                        return new RespFrame.IntegerFrame(v == null ? -2 : -1);
                    }
                    long remainingSec = (exp - System.currentTimeMillis()) / 1000;
                    if (remainingSec <= 0) {
                        keyTtlMap.remove(key);
                        executeRaftWrite(Command.delete(key));
                        return new RespFrame.IntegerFrame(-2);
                    }
                    return new RespFrame.IntegerFrame(remainingSec);
                }

                // ==========================================
                // Day 2: Redis Hashes (HSET, HGET, HDEL, HGETALL, HLEN)
                // ==========================================
                case "HSET" -> {
                    if (items.size() < 4 || (items.size() - 2) % 2 != 0) {
                        return new RespFrame.Error("wrong number of arguments for 'hset' command");
                    }
                    String key = extractString(items.get(1));
                    Map<String, String> hash = readHash(key);
                    int addedFields = 0;
                    for (int i = 2; i < items.size(); i += 2) {
                        String field = extractString(items.get(i));
                        String value = extractString(items.get(i + 1));
                        if (!hash.containsKey(field)) {
                            addedFields++;
                        }
                        hash.put(field, value);
                    }
                    saveHash(key, hash);
                    return new RespFrame.IntegerFrame(addedFields);
                }
                case "HGET" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'hget' command");
                    String key = extractString(items.get(1));
                    String field = extractString(items.get(2));
                    Map<String, String> hash = readHash(key);
                    String val = hash.get(field);
                    return (val == null) ? RespFrame.BulkString.NULL : RespFrame.BulkString.of(val);
                }
                case "HDEL" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'hdel' command");
                    String key = extractString(items.get(1));
                    Map<String, String> hash = readHash(key);
                    int removed = 0;
                    for (int i = 2; i < items.size(); i++) {
                        String field = extractString(items.get(i));
                        if (hash.remove(field) != null) {
                            removed++;
                        }
                    }
                    if (removed > 0) {
                        saveHash(key, hash);
                    }
                    return new RespFrame.IntegerFrame(removed);
                }
                case "HLEN" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'hlen' command");
                    String key = extractString(items.get(1));
                    Map<String, String> hash = readHash(key);
                    return new RespFrame.IntegerFrame(hash.size());
                }
                case "HGETALL" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'hgetall' command");
                    String key = extractString(items.get(1));
                    Map<String, String> hash = readHash(key);
                    List<RespFrame> elements = new ArrayList<>(hash.size() * 2);
                    for (Map.Entry<String, String> entry : hash.entrySet()) {
                        elements.add(RespFrame.BulkString.of(entry.getKey()));
                        elements.add(RespFrame.BulkString.of(entry.getValue()));
                    }
                    return new RespFrame.Array(elements);
                }

                // ==========================================
                // Day 2: Redis Sets (SADD, SMEMBERS, SREM, SCARD, SISMEMBER)
                // ==========================================
                case "SADD" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'sadd' command");
                    String key = extractString(items.get(1));
                    Set<String> set = readSet(key);
                    int added = 0;
                    for (int i = 2; i < items.size(); i++) {
                        String member = extractString(items.get(i));
                        if (set.add(member)) {
                            added++;
                        }
                    }
                    if (added > 0) {
                        saveSet(key, set);
                    }
                    return new RespFrame.IntegerFrame(added);
                }
                case "SMEMBERS" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'smembers' command");
                    String key = extractString(items.get(1));
                    Set<String> set = readSet(key);
                    List<RespFrame> elements = new ArrayList<>(set.size());
                    for (String member : set) {
                        elements.add(RespFrame.BulkString.of(member));
                    }
                    return new RespFrame.Array(elements);
                }
                case "SREM" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'srem' command");
                    String key = extractString(items.get(1));
                    Set<String> set = readSet(key);
                    int removed = 0;
                    for (int i = 2; i < items.size(); i++) {
                        String member = extractString(items.get(i));
                        if (set.remove(member)) {
                            removed++;
                        }
                    }
                    if (removed > 0) {
                        saveSet(key, set);
                    }
                    return new RespFrame.IntegerFrame(removed);
                }
                case "SCARD" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'scard' command");
                    String key = extractString(items.get(1));
                    Set<String> set = readSet(key);
                    return new RespFrame.IntegerFrame(set.size());
                }
                case "SISMEMBER" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'sismember' command");
                    String key = extractString(items.get(1));
                    String member = extractString(items.get(2));
                    Set<String> set = readSet(key);
                    return new RespFrame.IntegerFrame(set.contains(member) ? 1 : 0);
                }

                // ==========================================
                // Day 2: Redis Atomic Lists / Queues (LPUSH, RPUSH, LPOP, RPOP, LLEN, LRANGE)
                // ==========================================
                case "LPUSH" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'lpush' command");
                    String key = extractString(items.get(1));
                    LinkedList<String> list = readList(key);
                    for (int i = 2; i < items.size(); i++) {
                        list.addFirst(extractString(items.get(i)));
                    }
                    saveList(key, list);
                    return new RespFrame.IntegerFrame(list.size());
                }
                case "RPUSH" -> {
                    if (items.size() < 3) return new RespFrame.Error("wrong number of arguments for 'rpush' command");
                    String key = extractString(items.get(1));
                    LinkedList<String> list = readList(key);
                    for (int i = 2; i < items.size(); i++) {
                        list.addLast(extractString(items.get(i)));
                    }
                    saveList(key, list);
                    return new RespFrame.IntegerFrame(list.size());
                }
                case "LPOP" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'lpop' command");
                    String key = extractString(items.get(1));
                    LinkedList<String> list = readList(key);
                    if (list.isEmpty()) {
                        return RespFrame.BulkString.NULL;
                    }
                    String popped = list.removeFirst();
                    saveList(key, list);
                    return RespFrame.BulkString.of(popped);
                }
                case "RPOP" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'rpop' command");
                    String key = extractString(items.get(1));
                    LinkedList<String> list = readList(key);
                    if (list.isEmpty()) {
                        return RespFrame.BulkString.NULL;
                    }
                    String popped = list.removeLast();
                    saveList(key, list);
                    return RespFrame.BulkString.of(popped);
                }
                case "LLEN" -> {
                    if (items.size() < 2) return new RespFrame.Error("wrong number of arguments for 'llen' command");
                    String key = extractString(items.get(1));
                    LinkedList<String> list = readList(key);
                    return new RespFrame.IntegerFrame(list.size());
                }
                case "LRANGE" -> {
                    if (items.size() < 4) return new RespFrame.Error("wrong number of arguments for 'lrange' command");
                    String key = extractString(items.get(1));
                    int start = Integer.parseInt(extractString(items.get(2)));
                    int stop = Integer.parseInt(extractString(items.get(3)));
                    LinkedList<String> list = readList(key);
                    int size = list.size();
                    if (start < 0) start = Math.max(0, size + start);
                    if (stop < 0) stop = size + stop;
                    if (start >= size || start > stop) {
                        return RespFrame.Array.EMPTY;
                    }
                    stop = Math.min(stop, size - 1);
                    List<RespFrame> elements = new ArrayList<>(stop - start + 1);
                    for (int i = start; i <= stop; i++) {
                        elements.add(RespFrame.BulkString.of(list.get(i)));
                    }
                    return new RespFrame.Array(elements);
                }

                case "INFO" -> {
                    String roleStr = (raftNode != null && raftNode.getRole() != null) ? raftNode.getRole().name().toLowerCase() : "standalone";
                    String info = "# Server\r\nredis_version:7.2.0-raftline\r\n"
                            + "mode:cluster\r\n"
                            + "role:" + roleStr + "\r\n"
                            + "consensus_engine:Quorix\r\n";
                    return RespFrame.BulkString.of(info);
                }
                case "COMMAND" -> {
                    return RespFrame.Array.EMPTY;
                }
                case "QUIT" -> {
                    return RespFrame.SimpleString.OK;
                }
                default -> {
                    return new RespFrame.Error("ERR unknown command '" + cmd + "'");
                }
            }
        } catch (Exception e) {
            Throwable cause = e instanceof ExecutionException ? e.getCause() : e;
            if (cause instanceof NotLeaderException nle) {
                String leaderHint = (nle.getLeaderHint() != null) ? nle.getLeaderHint() : "unknown";
                return new RespFrame.Error("MOVED 0 " + leaderHint);
            }
            log.error("Failed executing Redis command {}", cmd, e);
            return new RespFrame.Error("ERR " + e.getMessage());
        }
    }

    // Helper functions for Hashes
    private Map<String, String> readHash(String key) {
        byte[] raw = executeRaftRead(key);
        if (raw == null || raw.length == 0) return new LinkedHashMap<>();
        try {
            return json.readValue(raw, new TypeReference<LinkedHashMap<String, String>>() {});
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private void saveHash(String key, Map<String, String> hash) throws Exception {
        byte[] raw = json.writeValueAsBytes(hash);
        executeRaftWrite(Command.put(key, raw));
    }

    // Helper functions for Sets
    private Set<String> readSet(String key) {
        byte[] raw = executeRaftRead(key);
        if (raw == null || raw.length == 0) return new LinkedHashSet<>();
        try {
            return json.readValue(raw, new TypeReference<LinkedHashSet<String>>() {});
        } catch (Exception e) {
            return new LinkedHashSet<>();
        }
    }

    private void saveSet(String key, Set<String> set) throws Exception {
        byte[] raw = json.writeValueAsBytes(set);
        executeRaftWrite(Command.put(key, raw));
    }

    // Helper functions for Lists
    private LinkedList<String> readList(String key) {
        byte[] raw = executeRaftRead(key);
        if (raw == null || raw.length == 0) return new LinkedList<>();
        try {
            return json.readValue(raw, new TypeReference<LinkedList<String>>() {});
        } catch (Exception e) {
            return new LinkedList<>();
        }
    }

    private void saveList(String key, LinkedList<String> list) throws Exception {
        byte[] raw = json.writeValueAsBytes(list);
        executeRaftWrite(Command.put(key, raw));
    }

    private RespFrame incrementBy(String key, long delta) throws Exception {
        byte[] existingBytes = executeRaftRead(key);
        long val = 0;
        if (existingBytes != null) {
            String existing = new String(existingBytes, StandardCharsets.UTF_8).trim();
            try {
                val = Long.parseLong(existing);
            } catch (NumberFormatException e) {
                return new RespFrame.Error("ERR value is not an integer or out of range");
            }
        }
        val += delta;
        executeRaftWrite(Command.put(key, String.valueOf(val).getBytes(StandardCharsets.UTF_8)));
        return new RespFrame.IntegerFrame(val);
    }

    private boolean isExpired(String key) {
        Long exp = keyTtlMap.get(key);
        return exp != null && System.currentTimeMillis() > exp;
    }

    private byte[] executeRaftRead(String key) {
        try {
            if (multiRaftManager != null) {
                return multiRaftManager.readLinearizable(key).get(5, TimeUnit.SECONDS);
            }
            return (raftNode != null) ? raftNode.readLinearizable(key).get(5, TimeUnit.SECONDS) : null;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void executeRaftWrite(Command cmd) throws Exception {
        if (multiRaftManager != null) {
            ApplyResult result = multiRaftManager.execute(cmd).get(5, TimeUnit.SECONDS);
            if (!result.isSuccess()) {
                throw new RuntimeException("Apply write failed on shard");
            }
            return;
        }
        if (raftNode != null) {
            ApplyResult result = raftNode.execute(cmd).get(5, TimeUnit.SECONDS);
            if (!result.isSuccess()) {
                throw new RuntimeException("Apply write failed on node");
            }
        }
    }

    private void executeRaftBatch(List<Command> batch) throws Exception {
        if (raftNode != null) {
            List<ApplyResult> results = raftNode.executeBatch(batch).get(5, TimeUnit.SECONDS);
            for (ApplyResult ar : results) {
                if (!ar.isSuccess()) {
                    throw new RuntimeException("Batch apply failed");
                }
            }
        }
    }

    private void writeFrame(BufferedOutputStream out, RespFrame frame) throws IOException {
        out.write(frame.encode());
        out.flush();
    }

    private String extractString(RespFrame frame) {
        if (frame instanceof RespFrame.BulkString bs) {
            return bs.asString();
        } else if (frame instanceof RespFrame.SimpleString ss) {
            return ss.value();
        }
        return null;
    }

    public int getPort() {
        return serverSocket != null ? serverSocket.getLocalPort() : port;
    }

    @Override
    public void close() throws IOException {
        running = false;
        if (serverSocket != null && !serverSocket.isClosed()) {
            serverSocket.close();
        }
        clientPool.shutdownNow();
    }
}
