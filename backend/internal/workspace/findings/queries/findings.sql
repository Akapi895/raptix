-- name: CreateFinding :one
INSERT INTO findings (run_id, title, description, severity, confidence, status)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, run_id, title, description, severity, confidence, status, version, created_at, updated_at;

-- name: CreateFindingRevision :one
INSERT INTO finding_revisions (
    finding_id, revision_no, title, description, severity, confidence, status,
    change_reason, actor
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING finding_id, revision_no, title, description, severity, confidence, status,
          change_reason, actor, created_at;

-- name: GetFinding :one
SELECT id, run_id, title, description, severity, confidence, status, version, created_at, updated_at
FROM findings
WHERE id = $1;

-- name: ListFindingsByRun :many
SELECT id, run_id, title, description, severity, confidence, status, version, created_at, updated_at
FROM findings
WHERE run_id = $1
ORDER BY created_at;

-- name: GetCurrentFindingRevision :one
SELECT finding_id, revision_no, title, description, severity, confidence, status,
       change_reason, actor, created_at
FROM finding_revisions
WHERE finding_id = $1
ORDER BY revision_no DESC
LIMIT 1;

-- name: GetFindingRevision :one
SELECT finding_id, revision_no, title, description, severity, confidence, status,
       change_reason, actor, created_at
FROM finding_revisions
WHERE finding_id = $1 AND revision_no = $2;

-- name: ListFindingRevisions :many
SELECT finding_id, revision_no, title, description, severity, confidence, status,
       change_reason, actor, created_at
FROM finding_revisions
WHERE finding_id = $1
ORDER BY revision_no DESC;

-- name: ListFindingRevisionEvidence :many
SELECT evidence_id, role
FROM finding_revision_evidence
WHERE finding_id = $1 AND revision_no = $2
ORDER BY evidence_id;

-- name: UpdateFindingContent :one
UPDATE findings
SET title = $2,
    description = $3,
    severity = $4,
    confidence = $5,
    version = version + 1,
    updated_at = now()
WHERE id = $1 AND version = $6
RETURNING id, run_id, title, description, severity, confidence, status, version, created_at, updated_at;

-- name: UpdateFindingStatus :one
UPDATE findings
SET status = $2,
    version = version + 1,
    updated_at = now()
WHERE id = $1 AND version = $3
RETURNING id, run_id, title, description, severity, confidence, status, version, created_at, updated_at;

-- name: NextFindingRevisionNo :one
SELECT COALESCE(MAX(revision_no), 0)::integer + 1 AS revision_no
FROM finding_revisions
WHERE finding_id = $1;

-- name: DeleteFindingEvidence :exec
DELETE FROM finding_evidence WHERE finding_id = $1;

-- name: InsertFindingEvidence :exec
INSERT INTO finding_evidence (finding_id, evidence_id, role)
VALUES ($1, $2, $3);

-- name: SnapshotFindingEvidence :exec
INSERT INTO finding_revision_evidence (finding_id, revision_no, evidence_id, role)
SELECT fe.finding_id, $2, fe.evidence_id, fe.role
FROM finding_evidence AS fe
WHERE fe.finding_id = $1;

-- name: CreateReviewHistory :exec
INSERT INTO finding_review_history (
    finding_id, from_revision_no, to_revision_no, from_status, to_status,
    reviewer, reason, legacy
)
VALUES ($1, $2, $3, $4, $5, $6, $7, false);

-- name: InsertVerdict :one
INSERT INTO finding_verdicts (finding_id, revision_no, verdict, reason, produced_by, legacy)
VALUES ($1, $2, $3, $4, $5, false)
RETURNING id, finding_id, revision_no, verdict, reason, produced_by, created_at, legacy;

-- name: ListVerdictsByFinding :many
SELECT id, finding_id, revision_no, verdict, reason, produced_by, created_at, legacy
FROM finding_verdicts
WHERE finding_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListReviewHistory :many
SELECT id, finding_id, from_revision_no, to_revision_no, from_status, to_status,
       reviewer, reason, created_at, legacy
FROM finding_review_history
WHERE finding_id = $1
ORDER BY created_at DESC, id DESC;
