package io.raftline.core.agent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/**
 * High-performance, low-latency Reactive Watch Stream and Event Dispatcher for AI agents.
 *
 * Implements prefix and exact-key watches with virtual-thread fan-out, unbounded/buffered
 * subscriber queues, and history replay from a monotonic version point (`sinceVersion`).
 */
public class AgentWatchEngine implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(AgentWatchEngine.class);

    private final ConcurrentMap<String, CopyOnWriteArrayList<WatcherRegistration>> exactWatchers = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<WatcherRegistration> prefixWatchers = new CopyOnWriteArrayList<>();

    // Bounded historical ring buffer for historical replays (e.g. up to 10,000 events)
    private static final int HISTORY_CAPACITY = 10_000;
    private final ConcurrentNavigableMap<Long, WatchEvent> historicalLog = new ConcurrentSkipListMap<>();
    private final java.util.concurrent.atomic.AtomicLong eventSeq = new java.util.concurrent.atomic.AtomicLong(0);

    private final ExecutorService dispatcher = Executors.newVirtualThreadPerTaskExecutor();
    private volatile boolean closed = false;

    public static class WatcherRegistration implements AutoCloseable {
        private final String filter;
        private final boolean isPrefix;
        private final Consumer<WatchEvent> consumer;
        private final BlockingQueue<WatchEvent> queue = new LinkedBlockingQueue<>(2000);
        private volatile boolean active = true;

        public WatcherRegistration(String filter, boolean isPrefix, Consumer<WatchEvent> consumer) {
            this.filter = filter;
            this.isPrefix = isPrefix;
            this.consumer = consumer;
        }

        public boolean matches(String key) {
            if (!active) return false;
            if (isPrefix) {
                return key.startsWith(filter);
            }
            return key.equals(filter);
        }

        public void dispatch(WatchEvent event) {
            if (!active) return;
            if (consumer != null) {
                try {
                    consumer.accept(event);
                } catch (Exception e) {
                    log.warn("Watcher consumer error: {}", e.getMessage());
                }
            } else {
                queue.offer(event);
            }
        }

        public WatchEvent poll(long timeoutMs) throws InterruptedException {
            return queue.poll(timeoutMs, TimeUnit.MILLISECONDS);
        }

        public BlockingQueue<WatchEvent> getQueue() {
            return queue;
        }

        @Override
        public void close() {
            active = false;
        }

        public boolean isActive() {
            return active;
        }
    }

    /**
     * Registers a watcher on an exact key or key prefix.
     *
     * @param keyOrPrefix Key or key prefix
     * @param isPrefix True if watching prefix, false if exact key
     * @param sinceVersion If greater than 0, replays historical events that occurred after this version
     * @param consumer Callback consumer for matching events (or null to poll from queue)
     * @return WatcherRegistration handle to receive events and close when done
     */
    public WatcherRegistration watch(String keyOrPrefix, boolean isPrefix, long sinceVersion, Consumer<WatchEvent> consumer) {
        WatcherRegistration reg = new WatcherRegistration(keyOrPrefix, isPrefix, consumer);

        if (isPrefix) {
            prefixWatchers.add(reg);
        } else {
            exactWatchers.computeIfAbsent(keyOrPrefix, k -> new CopyOnWriteArrayList<>()).add(reg);
        }

        // Replay historical events if sinceVersion is requested
        if (sinceVersion > 0) {
            dispatcher.submit(() -> {
                for (WatchEvent evt : historicalLog.values()) {
                    if (evt.version() > sinceVersion && reg.matches(evt.key())) {
                        reg.dispatch(evt);
                    }
                }
            });
        }

        return reg;
    }

    /**
     * Publishes a committed mutation event to all matching registered watchers.
     */
    public void publishEvent(WatchEvent.EventType type, String key, byte[] value, long version, long logIndex) {
        if (closed) return;

        WatchEvent event = new WatchEvent(type, key, value, version, logIndex, System.currentTimeMillis());

        // Record in historical ring buffer
        long seq = eventSeq.incrementAndGet();
        historicalLog.put(seq, event);
        if (historicalLog.size() > HISTORY_CAPACITY) {
            historicalLog.pollFirstEntry();
        }

        // Asynchronously fan out to watchers
        dispatcher.submit(() -> {
            // 1. Exact watchers
            List<WatcherRegistration> exacts = exactWatchers.get(key);
            if (exacts != null) {
                exacts.removeIf(w -> !w.isActive());
                for (WatcherRegistration w : exacts) {
                    w.dispatch(event);
                }
            }

            // 2. Prefix watchers
            prefixWatchers.removeIf(w -> !w.isActive());
            for (WatcherRegistration w : prefixWatchers) {
                if (w.matches(key)) {
                    w.dispatch(event);
                }
            }
        });
    }

    @Override
    public void close() {
        closed = true;
        prefixWatchers.forEach(WatcherRegistration::close);
        exactWatchers.values().forEach(list -> list.forEach(WatcherRegistration::close));
        prefixWatchers.clear();
        exactWatchers.clear();
        dispatcher.shutdown();
    }
}
