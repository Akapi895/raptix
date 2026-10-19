-- ADR-0092 I03: the runtime endpoint of a ready environment, recorded from the host controller.
-- Additive only.

-- AlterTable
ALTER TABLE "ProjectEnvironment" ADD COLUMN "runtimeUrl" TEXT;
