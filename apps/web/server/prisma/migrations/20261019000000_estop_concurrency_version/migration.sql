-- W10 (ADR-0074): optimistic concurrency guard for emergency-stop resolution.
ALTER TABLE "EmergencyStop" ADD COLUMN "concurrencyVersion" INTEGER NOT NULL DEFAULT 1;
