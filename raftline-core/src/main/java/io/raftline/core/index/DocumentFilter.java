package io.raftline.core.index;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.*;

/**
 * Filter predicate for querying JSON documents.
 * Supports leaf comparisons (EQ, NEQ, GT, GTE, LT, LTE, IN, CONTAINS, PREFIX)
 * and compound boolean logic (AND, OR).
 */
public class DocumentFilter {

    public enum FilterOp {
        EQ,
        NEQ,
        GT,
        GTE,
        LT,
        LTE,
        IN,
        CONTAINS,
        PREFIX
    }

    private final String field;
    private final FilterOp op;
    private final Object value;
    private final List<DocumentFilter> andFilters;
    private final List<DocumentFilter> orFilters;

    public DocumentFilter(String field, FilterOp op, Object value) {
        this.field = field;
        this.op = (op != null) ? op : FilterOp.EQ;
        this.value = value;
        this.andFilters = Collections.emptyList();
        this.orFilters = Collections.emptyList();
    }

    public DocumentFilter(List<DocumentFilter> andFilters, List<DocumentFilter> orFilters) {
        this.field = null;
        this.op = null;
        this.value = null;
        this.andFilters = (andFilters != null) ? List.copyOf(andFilters) : Collections.emptyList();
        this.orFilters = (orFilters != null) ? List.copyOf(orFilters) : Collections.emptyList();
    }

    public static DocumentFilter eq(String field, Object value) {
        return new DocumentFilter(field, FilterOp.EQ, value);
    }

    public static DocumentFilter neq(String field, Object value) {
        return new DocumentFilter(field, FilterOp.NEQ, value);
    }

    public static DocumentFilter gt(String field, Object value) {
        return new DocumentFilter(field, FilterOp.GT, value);
    }

    public static DocumentFilter gte(String field, Object value) {
        return new DocumentFilter(field, FilterOp.GTE, value);
    }

    public static DocumentFilter lt(String field, Object value) {
        return new DocumentFilter(field, FilterOp.LT, value);
    }

    public static DocumentFilter lte(String field, Object value) {
        return new DocumentFilter(field, FilterOp.LTE, value);
    }

    public static DocumentFilter in(String field, Collection<?> values) {
        return new DocumentFilter(field, FilterOp.IN, new ArrayList<>(values));
    }

    public static DocumentFilter contains(String field, Object value) {
        return new DocumentFilter(field, FilterOp.CONTAINS, value);
    }

    public static DocumentFilter prefix(String field, String prefix) {
        return new DocumentFilter(field, FilterOp.PREFIX, prefix);
    }

    public static DocumentFilter and(DocumentFilter... filters) {
        return new DocumentFilter(Arrays.asList(filters), Collections.emptyList());
    }

    public static DocumentFilter or(DocumentFilter... filters) {
        return new DocumentFilter(Collections.emptyList(), Arrays.asList(filters));
    }

    public String getField() {
        return field;
    }

    public FilterOp getOp() {
        return op;
    }

    public Object getValue() {
        return value;
    }

    public List<DocumentFilter> getAndFilters() {
        return andFilters;
    }

    public List<DocumentFilter> getOrFilters() {
        return orFilters;
    }

    public boolean isCompound() {
        return !andFilters.isEmpty() || !orFilters.isEmpty();
    }

    /**
     * Evaluates this filter predicate against a parsed JSON document.
     */
    public boolean test(JsonNode root) {
        if (root == null) {
            return false;
        }

        if (!andFilters.isEmpty()) {
            for (DocumentFilter f : andFilters) {
                if (!f.test(root)) {
                    return false;
                }
            }
            return true;
        }

        if (!orFilters.isEmpty()) {
            for (DocumentFilter f : orFilters) {
                if (f.test(root)) {
                    return true;
                }
            }
            return false;
        }

        if (field == null || op == null) {
            return true;
        }

        JsonNode targetNode = extractField(root, field);
        if (targetNode == null || targetNode.isNull() || targetNode.isMissingNode()) {
            return op == FilterOp.NEQ;
        }

        return evaluateOp(targetNode, op, value);
    }

    private static boolean evaluateOp(JsonNode target, FilterOp op, Object expected) {
        if (op == FilterOp.IN) {
            if (expected instanceof Collection<?> col) {
                for (Object item : col) {
                    if (evaluateOp(target, FilterOp.EQ, item)) {
                        return true;
                    }
                }
                return false;
            }
            return false;
        }

        if (target.isNumber() && expected instanceof Number expectedNum) {
            double actualD = target.asDouble();
            double expectedD = expectedNum.doubleValue();
            return switch (op) {
                case EQ -> Double.compare(actualD, expectedD) == 0;
                case NEQ -> Double.compare(actualD, expectedD) != 0;
                case GT -> actualD > expectedD;
                case GTE -> actualD >= expectedD;
                case LT -> actualD < expectedD;
                case LTE -> actualD <= expectedD;
                default -> false;
            };
        }

        if (target.isBoolean() && expected != null) {
            boolean actualB = target.asBoolean();
            boolean expectedB = Boolean.parseBoolean(expected.toString());
            return switch (op) {
                case EQ -> actualB == expectedB;
                case NEQ -> actualB != expectedB;
                default -> false;
            };
        }

        // String / generic fallback
        String actualStr = target.isTextual() ? target.asText() : target.toString();
        String expectedStr = (expected != null) ? expected.toString() : "";

        return switch (op) {
            case EQ -> actualStr.equals(expectedStr);
            case NEQ -> !actualStr.equals(expectedStr);
            case CONTAINS -> actualStr.contains(expectedStr);
            case PREFIX -> actualStr.startsWith(expectedStr);
            case GT -> actualStr.compareTo(expectedStr) > 0;
            case GTE -> actualStr.compareTo(expectedStr) >= 0;
            case LT -> actualStr.compareTo(expectedStr) < 0;
            case LTE -> actualStr.compareTo(expectedStr) <= 0;
            default -> false;
        };
    }

    public static JsonNode extractField(JsonNode root, String fieldPath) {
        if (root == null || fieldPath == null || fieldPath.isBlank()) {
            return null;
        }
        String[] parts = fieldPath.split("\\.");
        JsonNode current = root;
        for (String part : parts) {
            if (current == null || !current.has(part)) {
                return null;
            }
            current = current.get(part);
        }
        return current;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (!andFilters.isEmpty()) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (DocumentFilter f : andFilters) list.add(f.toMap());
            m.put("and", list);
            return m;
        }
        if (!orFilters.isEmpty()) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (DocumentFilter f : orFilters) list.add(f.toMap());
            m.put("or", list);
            return m;
        }
        if (field != null) {
            m.put("field", field);
            m.put("op", op != null ? op.name() : "EQ");
            m.put("value", value);
        }
        return m;
    }

    @SuppressWarnings("unchecked")
    public static DocumentFilter fromMap(Map<String, Object> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        if (map.containsKey("and")) {
            List<Map<String, Object>> andList = (List<Map<String, Object>>) map.get("and");
            List<DocumentFilter> filters = new ArrayList<>();
            for (Map<String, Object> item : andList) {
                DocumentFilter f = fromMap(item);
                if (f != null) filters.add(f);
            }
            return and(filters.toArray(new DocumentFilter[0]));
        }
        if (map.containsKey("or")) {
            List<Map<String, Object>> orList = (List<Map<String, Object>>) map.get("or");
            List<DocumentFilter> filters = new ArrayList<>();
            for (Map<String, Object> item : orList) {
                DocumentFilter f = fromMap(item);
                if (f != null) filters.add(f);
            }
            return or(filters.toArray(new DocumentFilter[0]));
        }

        String field = (String) map.get("field");
        String opStr = (String) map.getOrDefault("op", "EQ");
        FilterOp op;
        try {
            op = FilterOp.valueOf(opStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            op = FilterOp.EQ;
        }
        Object val = map.get("value");
        return new DocumentFilter(field, op, val);
    }
}
