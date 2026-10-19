package io.raftline.core.index;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Result of executing a document query over secondary indexes or state machine scans.
 */
public record QueryResult(
        int totalMatched,
        int returnedCount,
        boolean usedIndex,
        long executionTimeMs,
        List<DocumentMatch> results
) {
    public record DocumentMatch(String key, Object value) {}

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", "OK");
        m.put("totalMatched", totalMatched);
        m.put("returnedCount", returnedCount);
        m.put("usedIndex", usedIndex);
        m.put("executionTimeMs", executionTimeMs);

        List<Map<String, Object>> list = new ArrayList<>();
        if (results != null) {
            for (DocumentMatch match : results) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("key", match.key());
                if (match.value() != null) {
                    item.put("value", match.value());
                }
                list.add(item);
            }
        }
        m.put("results", list);
        return m;
    }
}
