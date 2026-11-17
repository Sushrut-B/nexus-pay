-- Financial workflow invariants that Prisma cannot declare.

ALTER TABLE "payment_intents"
    ADD CONSTRAINT "payment_intents_amount_positive"
        CHECK ("amountMinor" > 0 AND "amountMinor" <= 1000000000000),
    ADD CONSTRAINT "payment_intents_idempotency_key_shape"
        CHECK ("idempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$'),
    ADD CONSTRAINT "payment_intents_client_request_present"
        CHECK (length(btrim("clientRequestId")) >= 8),
    ADD CONSTRAINT "payment_intents_currency_format"
        CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "payment_intents_attempts_non_negative"
        CHECK ("attemptCount" >= 0),
    ADD CONSTRAINT "payment_intents_no_self_payment"
        CHECK ("recipientUserId" IS NULL OR "recipientUserId" <> "userId"),
    ADD CONSTRAINT "payment_intents_settled_verified"
        CHECK ("status" <> 'SETTLED' OR ("paymentRef" IS NOT NULL AND "receiptVerifiedAt" IS NOT NULL)),
    ADD CONSTRAINT "payment_intents_rejected_reason"
        CHECK ("status" <> 'REJECTED' OR "rejectionCode" IS NOT NULL);

ALTER TABLE "funding_operations"
    ADD CONSTRAINT "funding_operations_amount_positive"
        CHECK ("amountMinor" > 0 AND "amountMinor" <= 1000000000000),
    ADD CONSTRAINT "funding_operations_idempotency_key_shape"
        CHECK ("idempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$'),
    ADD CONSTRAINT "funding_operations_client_request_present"
        CHECK (length(btrim("clientRequestId")) >= 8),
    ADD CONSTRAINT "funding_operations_currency_format"
        CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "funding_operations_attempts_non_negative"
        CHECK ("attemptCount" >= 0),
    ADD CONSTRAINT "funding_operations_completed_verified"
        CHECK (
            "status" <> 'COMPLETED'
            OR ("fundingRef" IS NOT NULL AND "receiptVerifiedAt" IS NOT NULL AND "balanceAfterMinor" IS NOT NULL)
        ),
    ADD CONSTRAINT "funding_operations_failed_reason"
        CHECK ("status" <> 'FAILED' OR "failureCode" IS NOT NULL);

ALTER TABLE "transaction_records"
    ADD CONSTRAINT "transaction_records_amount_positive"
        CHECK ("amountMinor" > 0 AND "amountMinor" <= 1000000000000),
    ADD CONSTRAINT "transaction_records_currency_format"
        CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "transaction_records_success_has_reference"
        CHECK ("status" <> 'SUCCESSFUL' OR "paymentRef" IS NOT NULL);
