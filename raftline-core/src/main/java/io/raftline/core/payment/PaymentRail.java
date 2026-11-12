package io.raftline.core.payment;

/**
 * Supported real-time payment rails and clearing networks.
 */
public enum PaymentRail {
    FEDNOW("Federal Reserve Instant Payment Service"),
    SEPA_INSTANT("Single Euro Payments Area Instant Credit Transfer"),
    UPI("Unified Payments Interface"),
    FASTER_PAYMENTS("UK Faster Payments System"),
    INTERNAL_BOOK("Internal Real-Time Ledger Transfer");

    private final String description;

    PaymentRail(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }

    public static PaymentRail fromString(String val) {
        if (val == null || val.isBlank()) return INTERNAL_BOOK;
        try {
            return PaymentRail.valueOf(val.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return INTERNAL_BOOK;
        }
    }
}

