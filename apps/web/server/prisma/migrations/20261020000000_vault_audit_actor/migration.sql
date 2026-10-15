-- W25: record the trusted session actor on new vault audit rows.
-- Historical rows remain NULL; they are never backfilled with an invented identity.
ALTER TABLE "VaultAudit" ADD COLUMN "actorId" TEXT;
