package io.raftline.core.index;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Definition and metadata for a secondary index.
 */
public record IndexDefinition(
        String name,
        String keyPrefix,
        String field,
        IndexFieldType type,
        long createdEpochMs
) {
    public IndexDefinition {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(field, "field");
        keyPrefix = (keyPrefix != null) ? keyPrefix : "";
        type = (type != null) ? type : IndexFieldType.STRING;
    }

    public IndexDefinition(String name, String keyPrefix, String field, IndexFieldType type) {
        this(name, keyPrefix, field, type, System.currentTimeMillis());
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("keyPrefix", keyPrefix);
        m.put("field", field);
        m.put("type", type.name());
        m.put("createdEpochMs", createdEpochMs);
        return m;
    }
}
