package io.raftline.core.index;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.storage.model.CommandType;
import io.raftline.storage.state.StateMachine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * High-Performance Secondary Indexing and Document Filter Engine.
 *
 * Maintains inverted index mappings for fast field lookups, range slicing,
 * and multi-predicate boolean filtering on committed JSON documents.
 */
public class SecondaryIndexEngine implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(SecondaryIndexEngine.class);
    private static final ObjectMapper json = new ObjectMapper();

    private final ConcurrentMap<String, SecondaryIndex> indexes = new ConcurrentHashMap<>();

    public SecondaryIndexEngine() {
    }

    /**
     * Registers a new secondary index and backfills existing documents from the state machine.
     */
    public SecondaryIndex registerIndex(IndexDefinition definition, StateMachine stateMachine) {
        Objects.requireNonNull(definition, "definition");
        SecondaryIndex index = new SecondaryIndex(definition);
        indexes.put(definition.name(), index);
        log.info("Registered secondary index '{}' on prefix '{}' for field '{}' ({})",
                definition.name(), definition.keyPrefix(), definition.field(), definition.type());

        // Backfill existing keys from state machine
        if (stateMachine != null) {
            backfillIndex(index, stateMachine);
        }

        return index;
    }

    /**
     * Drops a registered secondary index by name.
     */
    public boolean dropIndex(String indexName) {
        if (indexName == null) {
            return false;
        }
        SecondaryIndex removed = indexes.remove(indexName);
        if (removed != null) {
            removed.clear();
            log.info("Dropped secondary index '{}'", indexName);
            return true;
        }
        return false;
    }

    /**
     * Retrieves an index by name.
     */
    public SecondaryIndex getIndex(String indexName) {
        return indexes.get(indexName);
    }

    /**
     * Returns all registered secondary indexes.
     */
    public List<SecondaryIndex> getAllIndexes() {
        return new ArrayList<>(indexes.values());
    }

    /**
     * Hooks into committed state machine mutations to maintain real-time index consistency.
     */
    public void onCommittedMutation(String key, byte[] previousValue, byte[] newValue, CommandType op) {
        if (key == null || indexes.isEmpty()) {
            return;
        }

        for (SecondaryIndex idx : indexes.values()) {
            String prefix = idx.getKeyPrefix();
            if (prefix.isEmpty() || key.startsWith(prefix)) {
                if (op == CommandType.DELETE || newValue == null || newValue.length == 0) {
                    idx.removeKey(key);
                } else if (op == CommandType.PUT || op == CommandType.CAS) {
                    try {
                        JsonNode root = json.readTree(newValue);
                        if (root != null && root.isObject()) {
                            JsonNode fieldNode = DocumentFilter.extractField(root, idx.getField());
                            if (fieldNode != null && !fieldNode.isNull() && !fieldNode.isMissingNode()) {
                                Object val = extractValue(fieldNode, idx.getType());
                                idx.indexKey(key, val);
                            } else {
                                idx.removeKey(key);
                            }
                        } else {
                            idx.removeKey(key);
                        }
                    } catch (Exception e) {
                        // Not a JSON document or parsing error -> remove from index
                        idx.removeKey(key);
                    }
                }
            }
        }
    }

    private void backfillIndex(SecondaryIndex idx, StateMachine stateMachine) {
        try {
            String fromKey = idx.getKeyPrefix();
            String toKey = fromKey.isEmpty() ? null : fromKey + "\uffff";
            Map<String, byte[]> existing = stateMachine.scan(fromKey, toKey, Integer.MAX_VALUE);

            for (Map.Entry<String, byte[]> entry : existing.entrySet()) {
                String k = entry.getKey();
                byte[] v = entry.getValue();
                if (v != null && v.length > 0) {
                    try {
                        JsonNode root = json.readTree(v);
                        if (root != null && root.isObject()) {
                            JsonNode fieldNode = DocumentFilter.extractField(root, idx.getField());
                            if (fieldNode != null && !fieldNode.isNull() && !fieldNode.isMissingNode()) {
                                Object val = extractValue(fieldNode, idx.getType());
                                idx.indexKey(k, val);
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
            log.info("Backfilled index '{}': indexed {} matching documents", idx.getName(), idx.stats().get("indexedKeysCount"));
        } catch (Exception e) {
            log.warn("Failed to backfill secondary index '{}'", idx.getName(), e);
        }
    }

    public static Object extractValue(JsonNode node, IndexFieldType type) {
        if (node == null || node.isNull()) {
            return null;
        }
        return switch (type) {
            case STRING -> node.isTextual() ? node.asText() : node.toString();
            case NUMBER -> node.isNumber() ? node.asDouble() : Double.parseDouble(node.asText());
            case BOOLEAN -> node.isBoolean() ? node.asBoolean() : Boolean.parseBoolean(node.asText());
        };
    }

    /**
     * Executes a structured document query utilizing secondary indexes when applicable
     * or performing optimized filtered scans.
     */
    public QueryResult executeQuery(QueryRequest request, StateMachine stateMachine) {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(stateMachine, "stateMachine");
        long startMs = System.currentTimeMillis();

        DocumentFilter filter = request.filter();
        String prefix = request.prefix();

        Set<String> candidateKeys = null;
        boolean usedIndex = false;

        // Step 1: Query Planner - Evaluate index utilization
        if (filter != null) {
            if (!filter.isCompound()) {
                // Leaf filter
                SecondaryIndex idx = findMatchingIndex(prefix, filter.getField());
                if (idx != null) {
                    Set<String> matched = evaluateLeafIndexLookup(idx, filter);
                    if (matched != null) {
                        candidateKeys = matched;
                        usedIndex = true;
                    }
                }
            } else if (!filter.getAndFilters().isEmpty()) {
                // Compound AND - intersect indexed sub-filters
                for (DocumentFilter subF : filter.getAndFilters()) {
                    if (!subF.isCompound()) {
                        SecondaryIndex idx = findMatchingIndex(prefix, subF.getField());
                        if (idx != null) {
                            Set<String> matched = evaluateLeafIndexLookup(idx, subF);
                            if (matched != null) {
                                if (candidateKeys == null) {
                                    candidateKeys = new HashSet<>(matched);
                                } else {
                                    candidateKeys.retainAll(matched);
                                }
                                usedIndex = true;
                            }
                        }
                    }
                }
            }
        }

        // Step 2: Fetch and evaluate residual filter conditions
        List<QueryResult.DocumentMatch> matchedDocs = new ArrayList<>();

        if (usedIndex) {
            // Evaluated via index -> candidateKeys contains matching or candidate keys
            for (String key : candidateKeys) {
                byte[] raw = stateMachine.get(key);
                if (raw == null || raw.length == 0) {
                    continue;
                }

                try {
                    JsonNode root = json.readTree(raw);
                    // Evaluate residual filter if compound or not fully covered
                    if (filter == null || filter.test(root)) {
                        Object val = request.includeValues() ? root : null;
                        matchedDocs.add(new QueryResult.DocumentMatch(key, val));
                    }
                } catch (Exception e) {
                    if (filter == null) {
                        Object val = request.includeValues() ? new String(raw, StandardCharsets.UTF_8) : null;
                        matchedDocs.add(new QueryResult.DocumentMatch(key, val));
                    }
                }
            }
        } else {
            // No index matched -> scan state machine over prefix
            String fromKey = prefix;
            String toKey = prefix.isEmpty() ? null : prefix + "\uffff";
            Map<String, byte[]> scanned = stateMachine.scan(fromKey, toKey, 10_000);

            for (Map.Entry<String, byte[]> entry : scanned.entrySet()) {
                String key = entry.getKey();
                byte[] raw = entry.getValue();
                if (raw == null || raw.length == 0) continue;

                if (filter == null) {
                    Object val = request.includeValues() ? parseJsonOrString(raw) : null;
                    matchedDocs.add(new QueryResult.DocumentMatch(key, val));
                } else {
                    try {
                        JsonNode root = json.readTree(raw);
                        if (filter.test(root)) {
                            Object val = request.includeValues() ? root : null;
                            matchedDocs.add(new QueryResult.DocumentMatch(key, val));
                        }
                    } catch (Exception ignored) {}
                }
            }
        }

        // Sort keys consistently for deterministic pagination
        matchedDocs.sort(Comparator.comparing(QueryResult.DocumentMatch::key));

        int totalMatched = matchedDocs.size();
        int offset = Math.min(request.offset(), totalMatched);
        int toIndex = Math.min(offset + request.limit(), totalMatched);
        List<QueryResult.DocumentMatch> pagedResults = (offset < totalMatched)
                ? matchedDocs.subList(offset, toIndex)
                : Collections.emptyList();

        long durationMs = System.currentTimeMillis() - startMs;
        return new QueryResult(totalMatched, pagedResults.size(), usedIndex, durationMs, pagedResults);
    }

    private SecondaryIndex findMatchingIndex(String queryPrefix, String fieldName) {
        if (fieldName == null) return null;
        for (SecondaryIndex idx : indexes.values()) {
            if (idx.getField().equals(fieldName)) {
                String idxPrefix = idx.getKeyPrefix();
                if (idxPrefix.isEmpty() || queryPrefix.startsWith(idxPrefix) || idxPrefix.startsWith(queryPrefix)) {
                    return idx;
                }
            }
        }
        return null;
    }

    private Set<String> evaluateLeafIndexLookup(SecondaryIndex idx, DocumentFilter f) {
        if (f.getOp() == DocumentFilter.FilterOp.EQ) {
            return idx.lookupEqual(f.getValue());
        }

        if (idx.getType() == IndexFieldType.NUMBER && f.getValue() instanceof Number num) {
            double val = num.doubleValue();
            return switch (f.getOp()) {
                case GT -> idx.lookupRange(val, false, null, true);
                case GTE -> idx.lookupRange(val, true, null, true);
                case LT -> idx.lookupRange(null, true, val, false);
                case LTE -> idx.lookupRange(null, true, val, true);
                default -> null;
            };
        }

        if (idx.getType() == IndexFieldType.STRING && f.getOp() == DocumentFilter.FilterOp.PREFIX && f.getValue() != null) {
            return idx.lookupPrefix(f.getValue().toString());
        }

        return null;
    }

    private static Object parseJsonOrString(byte[] raw) {
        try {
            return json.readTree(raw);
        } catch (Exception e) {
            return new String(raw, StandardCharsets.UTF_8);
        }
    }

    @Override
    public void close() {
        for (SecondaryIndex idx : indexes.values()) {
            idx.clear();
        }
        indexes.clear();
    }
}
