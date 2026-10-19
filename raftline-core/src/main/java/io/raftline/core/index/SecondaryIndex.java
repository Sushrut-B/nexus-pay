package io.raftline.core.index;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;

/**
 * Thread-safe Inverted Secondary Index on a specific document field.
 * Supports exact match, numerical range slicing, and string prefix lookups.
 */
public class SecondaryIndex {

    private final IndexDefinition definition;
    private final ConcurrentMap<String, Object> keyToValue = new ConcurrentHashMap<>();

    private final ConcurrentNavigableMap<String, Set<String>> stringIndex = new ConcurrentSkipListMap<>();
    private final ConcurrentNavigableMap<Double, Set<String>> numberIndex = new ConcurrentSkipListMap<>();
    private final ConcurrentNavigableMap<Boolean, Set<String>> booleanIndex = new ConcurrentSkipListMap<>();

    public SecondaryIndex(IndexDefinition definition) {
        this.definition = Objects.requireNonNull(definition, "definition");
    }

    public IndexDefinition getDefinition() {
        return definition;
    }

    public String getName() {
        return definition.name();
    }

    public String getKeyPrefix() {
        return definition.keyPrefix();
    }

    public String getField() {
        return definition.field();
    }

    public IndexFieldType getType() {
        return definition.type();
    }

    /**
     * Indexes or updates the value for a primary key.
     */
    public void indexKey(String primaryKey, Object rawValue) {
        if (primaryKey == null || rawValue == null) {
            removeKey(primaryKey);
            return;
        }

        Object typedValue = castToType(rawValue);
        if (typedValue == null) {
            removeKey(primaryKey);
            return;
        }

        Object previousValue = keyToValue.put(primaryKey, typedValue);
        if (previousValue != null && !previousValue.equals(typedValue)) {
            removeFromBucket(primaryKey, previousValue);
        }

        addToBucket(primaryKey, typedValue);
    }

    /**
     * Removes a primary key from the index.
     */
    public void removeKey(String primaryKey) {
        if (primaryKey == null) {
            return;
        }
        Object previousValue = keyToValue.remove(primaryKey);
        if (previousValue != null) {
            removeFromBucket(primaryKey, previousValue);
        }
    }

    private Object castToType(Object raw) {
        try {
            return switch (definition.type()) {
                case STRING -> raw.toString();
                case NUMBER -> (raw instanceof Number n) ? n.doubleValue() : Double.parseDouble(raw.toString());
                case BOOLEAN -> (raw instanceof Boolean b) ? b : Boolean.parseBoolean(raw.toString());
            };
        } catch (Exception e) {
            return null;
        }
    }

    private void addToBucket(String primaryKey, Object value) {
        switch (definition.type()) {
            case STRING -> stringIndex.computeIfAbsent((String) value, k -> ConcurrentHashMap.newKeySet()).add(primaryKey);
            case NUMBER -> numberIndex.computeIfAbsent((Double) value, k -> ConcurrentHashMap.newKeySet()).add(primaryKey);
            case BOOLEAN -> booleanIndex.computeIfAbsent((Boolean) value, k -> ConcurrentHashMap.newKeySet()).add(primaryKey);
        }
    }

    private void removeFromBucket(String primaryKey, Object value) {
        Set<String> set = null;
        switch (definition.type()) {
            case STRING -> set = stringIndex.get((String) value);
            case NUMBER -> set = numberIndex.get((Double) value);
            case BOOLEAN -> set = booleanIndex.get((Boolean) value);
        }
        if (set != null) {
            set.remove(primaryKey);
        }
    }

    /**
     * Looks up primary keys whose indexed field equals the given value.
     */
    public Set<String> lookupEqual(Object rawValue) {
        Object typed = castToType(rawValue);
        if (typed == null) {
            return Collections.emptySet();
        }

        Set<String> keys = switch (definition.type()) {
            case STRING -> stringIndex.get((String) typed);
            case NUMBER -> numberIndex.get((Double) typed);
            case BOOLEAN -> booleanIndex.get((Boolean) typed);
        };

        return (keys != null) ? new HashSet<>(keys) : Collections.emptySet();
    }

    /**
     * Looks up primary keys in a numerical range [min, max].
     */
    public Set<String> lookupRange(Double min, boolean minInclusive, Double max, boolean maxInclusive) {
        if (definition.type() != IndexFieldType.NUMBER) {
            return Collections.emptySet();
        }

        ConcurrentNavigableMap<Double, Set<String>> sub;
        if (min != null && max != null) {
            sub = numberIndex.subMap(min, minInclusive, max, maxInclusive);
        } else if (min != null) {
            sub = numberIndex.tailMap(min, minInclusive);
        } else if (max != null) {
            sub = numberIndex.headMap(max, maxInclusive);
        } else {
            sub = numberIndex;
        }

        Set<String> result = new HashSet<>();
        for (Set<String> s : sub.values()) {
            result.addAll(s);
        }
        return result;
    }

    /**
     * Looks up primary keys whose indexed string value starts with prefix.
     */
    public Set<String> lookupPrefix(String prefix) {
        if (definition.type() != IndexFieldType.STRING || prefix == null || prefix.isEmpty()) {
            return Collections.emptySet();
        }

        ConcurrentNavigableMap<String, Set<String>> sub = stringIndex.subMap(prefix, true, prefix + "\uffff", true);
        Set<String> result = new HashSet<>();
        for (Set<String> s : sub.values()) {
            result.addAll(s);
        }
        return result;
    }

    /**
     * Returns statistics for this secondary index.
     */
    public Map<String, Object> stats() {
        int uniqueValues = switch (definition.type()) {
            case STRING -> stringIndex.size();
            case NUMBER -> numberIndex.size();
            case BOOLEAN -> booleanIndex.size();
        };

        Map<String, Object> map = new LinkedHashMap<>();
        map.put("name", definition.name());
        map.put("keyPrefix", definition.keyPrefix());
        map.put("field", definition.field());
        map.put("type", definition.type().name());
        map.put("createdEpochMs", definition.createdEpochMs());
        map.put("indexedKeysCount", keyToValue.size());
        map.put("uniqueValuesCount", uniqueValues);
        return map;
    }

    public void clear() {
        keyToValue.clear();
        stringIndex.clear();
        numberIndex.clear();
        booleanIndex.clear();
    }
}
