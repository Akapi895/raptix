-- ADR-0092 I06: archive keeps the project data and blocks activation until unarchive. Additive only.

-- AlterEnum
ALTER TYPE "EnvironmentCommandAction" ADD VALUE 'archive';
ALTER TYPE "EnvironmentCommandAction" ADD VALUE 'unarchive';

-- AlterTable
ALTER TABLE "ProjectEnvironment" ADD COLUMN "archivedAt" TIMESTAMP(3);
