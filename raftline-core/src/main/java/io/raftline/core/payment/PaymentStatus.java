package io.raftline.core.payment;

/**
 * Lifecycle states of an electronic payment instruction or authorization hold.
 */
public enum PaymentStatus {
    SETTLED,       // Funds irrevocably debited and credited via consensus quorum
    AUTHORIZED,    // Funds held on debtor account, awaiting capture
    CAPTURED,      // Authorized hold converted to final settlement
    VOIDED,        // Authorized hold canceled, reserved funds released
    REJECTED       // Transaction rejected by policy, currency mismatch, or balance invariant
}

