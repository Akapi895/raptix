-- ADR-0102: a project no longer records a server-side workspace path. Its files live only in its sandbox volume.
ALTER TABLE "Engagement" DROP COLUMN "workspacePath";
