-- name: CreateArtifact :one
INSERT INTO artifacts (run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at;

-- name: GetArtifact :one
SELECT id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at
FROM artifacts
WHERE id = $1;

-- name: GetArtifactBySHA256 :one
-- Content-addressed lookup. Identical bytes can legitimately appear in several
-- runs, so this is deterministic newest-first (created_at then id) rather than
-- an unordered LIMIT 1.
SELECT id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at
FROM artifacts
WHERE sha256 = $1
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: GetArtifactBySHA256InRun :one
-- Run-qualified content lookup: returns the newest artifact with the checksum
-- inside a specific run, so a call site that already knows the run gets an
-- unambiguous answer even when the same bytes recur across other runs.
SELECT id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at
FROM artifacts
WHERE run_id = $1 AND sha256 = $2
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: ListArtifactsByRun :many
SELECT id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at
FROM artifacts
WHERE run_id = $1
ORDER BY created_at DESC;

-- name: ListDerivedArtifacts :many
SELECT id, run_id, kind, mime, size, sha256, schema_version, parser_version, sensitivity, storage_key, rel_type, parent_id, created_at
FROM artifacts
WHERE parent_id = $1
ORDER BY created_at DESC;
