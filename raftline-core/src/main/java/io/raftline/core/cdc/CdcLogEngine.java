package io.raftline.core.cdc;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Embedded Change Data Capture (CDC) and Transactional Outbox Engine.
 *
 * Captures all consensus-committed mutations (PUT, CAS, DELETE, OUTBOX) in a deterministic,
 * ordered ring buffer. Tracks consumer group watermarks for guaranteed at-least-once downstream delivery.
 */
public class CdcLogEngine implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(CdcLogEngine.class);

    private static final int DEFAULT_RETENTION_CAPACITY = 20_000;

    private final int capacity;
    private final ConcurrentNavigableMap<Long, CdcEvent> eventStore = new ConcurrentSkipListMap<>();
    private final ConcurrentMap<String, Long> consumerWatermarks = new ConcurrentHashMap<>();
    private final AtomicLong eventIdGenerator = new AtomicLong(0);

    public CdcLogEngine() {
        this(DEFAULT_RETENTION_CAPACITY);
    }

    public CdcLogEngine(int capacity) {
        this.capacity = capacity;
    }

    /**
     * Appends a committed mutation event to the CDC log.
     */
    public CdcEvent recordEvent(long logIndex, long logTerm, CdcEvent.OperationType op, String key, byte[] payload, long version) {
        long eventId = eventIdGenerator.incrementAndGet();
        CdcEvent event = new CdcEvent(
                eventId,
                logIndex,
                logTerm,
                op,
                key,
                payload,
                version,
                System.currentTimeMillis()
        );

        eventStore.put(logIndex, event);

        // Bounded retention eviction: prune entries older than min watermark if capacity exceeded
        if (eventStore.size() > capacity) {
            long minWatermark = getLowestConsumerWatermark();
            while (eventStore.size() > capacity && !eventStore.isEmpty()) {
                long oldestIndex = eventStore.firstKey();
                if (oldestIndex < minWatermark || consumerWatermarks.isEmpty()) {
                    eventStore.pollFirstEntry();
                } else {
                    break;
                }
            }
        }

        return event;
    }

    /**
     * Polls events committed strictly after `sinceLogIndex` up to `limit` events.
     */
    public List<CdcEvent> pollEvents(long sinceLogIndex, int limit) {
        int max = (limit > 0) ? Math.min(limit, 1000) : 100;
        List<CdcEvent> results = new ArrayList<>();

        for (Map.Entry<Long, CdcEvent> entry : eventStore.tailMap(sinceLogIndex, false).entrySet()) {
            results.add(entry.getValue());
            if (results.size() >= max) {
                break;
            }
        }

        return results;
    }

    /**
     * Acknowledges consumer watermark progress.
     *
     * @param consumerId Name of consumer or downstream sink (e.g. "search-indexer", "kafka-sink")
     * @param logIndex The highest log index successfully processed
     * @return The updated watermark
     */
    public long acknowledgeWatermark(String consumerId, long logIndex) {
        Objects.requireNonNull(consumerId, "consumerId");
        return consumerWatermarks.compute(consumerId, (k, current) -> {
            if (current == null || logIndex > current) {
                return logIndex;
            }
            return current;
        });
    }

    /**
     * Gets the current progress watermark for a consumer.
     */
    public long getWatermark(String consumerId) {
        return consumerWatermarks.getOrDefault(consumerId, 0L);
    }

    /**
     * Returns all registered consumer watermarks.
     */
    public Map<String, Long> getAllWatermarks() {
        return Collections.unmodifiableMap(consumerWatermarks);
    }

    /**
     * Lowest watermark across active registered consumers.
     */
    public long getLowestConsumerWatermark() {
        if (consumerWatermarks.isEmpty()) {
            return 0L;
        }
        return consumerWatermarks.values().stream().min(Long::compareTo).orElse(0L);
    }

    /**
     * Returns total events retained in memory.
     */
    public int size() {
        return eventStore.size();
    }

    @Override
    public void close() {
        eventStore.clear();
        consumerWatermarks.clear();
    }
}
