package io.raftline.core.index;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Request payload for querying JSON documents via secondary indexes and document filters.
 */
public record QueryRequest(
        String prefix,
        DocumentFilter filter,
        int limit,
        int offset,
        boolean includeValues
) {
    public QueryRequest {
        prefix = (prefix != null) ? prefix : "";
        limit = (limit > 0) ? Math.min(limit, 1000) : 100;
        offset = Math.max(0, offset);
    }

    public QueryRequest(String prefix, DocumentFilter filter) {
        this(prefix, filter, 100, 0, true);
    }

    public QueryRequest(String prefix, DocumentFilter filter, boolean includeValues) {
        this(prefix, filter, 100, 0, includeValues);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("prefix", prefix);
        if (filter != null) {
            m.put("filter", filter.toMap());
        }
        m.put("limit", limit);
        m.put("offset", offset);
        m.put("includeValues", includeValues);
        return m;
    }

    @SuppressWarnings("unchecked")
    public static QueryRequest fromMap(Map<String, Object> map) {
        if (map == null) {
            return new QueryRequest("", null);
        }
        String prefix = (String) map.getOrDefault("prefix", "");
        DocumentFilter filter = null;
        if (map.containsKey("filter") && map.get("filter") instanceof Map<?, ?> fMap) {
            filter = DocumentFilter.fromMap((Map<String, Object>) fMap);
        } else if (map.containsKey("and") || map.containsKey("or") || map.containsKey("field")) {
            filter = DocumentFilter.fromMap(map);
        }

        int limit = 100;
        if (map.containsKey("limit")) {
            try {
                limit = ((Number) map.get("limit")).intValue();
            } catch (Exception ignored) {}
        }

        int offset = 0;
        if (map.containsKey("offset")) {
            try {
                offset = ((Number) map.get("offset")).intValue();
            } catch (Exception ignored) {}
        }

        boolean includeValues = true;
        if (map.containsKey("includeValues")) {
            try {
                includeValues = Boolean.parseBoolean(map.get("includeValues").toString());
            } catch (Exception ignored) {}
        }

        return new QueryRequest(prefix, filter, limit, offset, includeValues);
    }
}
