-- name: CreateFinding :one
INSERT INTO findings (run_id, title, description, severity, confidence, status)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, run_id, title, description, severity, confidence, status, version, created_at, updated_at;

-- name: GetFinding :one
SELECT id, run_id, title, description, severity, confidence, status, version, created_at, updated_at
FROM findings
WHERE id = $1;

-- name: ListFindingsByRun :many
SELECT id, run_id, title, description, severity, confidence, status, version, created_at, updated_at
FROM findings
WHERE run_id = $1
ORDER BY created_at;

-- name: TransitionFindingWithHistory :one
-- Atomically applies a finding status transition and records its review
-- history in a single statement. from_status is read from the very row being
-- updated (not supplied by the caller), so the history can never disagree with
-- the pre-image. A stale version produces no updated row (optimistic lock) and
-- therefore no history row.
WITH prev AS (
    SELECT findings.id, findings.status
    FROM findings
    WHERE findings.id = $1 AND findings.version = $3
),
updated AS (
    UPDATE findings
    SET status = $2, version = findings.version + 1, updated_at = now()
    WHERE findings.id = $1 AND findings.version = $3
    RETURNING findings.id, findings.run_id, findings.title, findings.description, findings.severity, findings.confidence, findings.status, findings.version, findings.created_at, findings.updated_at
),
inserted AS (
    INSERT INTO finding_review_history (finding_id, from_status, to_status, reviewer, reason)
    SELECT u.id, p.status, u.status, $4, $5
    FROM updated u JOIN prev p ON p.id = u.id
)
SELECT u.id, u.run_id, u.title, u.description, u.severity, u.confidence, u.status, u.version, u.created_at, u.updated_at
FROM updated u;

-- name: LinkFindingEvidence :exec
INSERT INTO finding_evidence (finding_id, evidence_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (finding_id, evidence_id) DO UPDATE SET role = EXCLUDED.role;

-- name: InsertVerdict :one
INSERT INTO finding_verdicts (finding_id, verdict, reason, produced_by)
VALUES ($1, $2, $3, $4)
RETURNING id, finding_id, verdict, reason, produced_by, created_at;

-- name: ListVerdictsByFinding :many
SELECT id, finding_id, verdict, reason, produced_by, created_at
FROM finding_verdicts
WHERE finding_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListReviewHistory :many
SELECT id, finding_id, from_status, to_status, reviewer, reason, created_at
FROM finding_review_history
WHERE finding_id = $1
ORDER BY created_at DESC, id DESC;
