-- Persist whether the last verified ledger receipt was an idempotent replay.
-- This is evidence about the ledger outcome, not a second financial ledger.

ALTER TABLE "payment_intents"
    ADD COLUMN "lastWasIdempotentReplay" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "funding_operations"
    ADD COLUMN "lastWasIdempotentReplay" BOOLEAN NOT NULL DEFAULT false;
