-- name: CreateAsset :one
INSERT INTO assets (run_id, kind, name, properties)
VALUES ($1, $2, $3, $4)
RETURNING id, run_id, kind, name, properties, created_at;

-- name: GetAsset :one
SELECT id, run_id, kind, name, properties, created_at
FROM assets
WHERE id = $1;

-- name: ListAssetsByRun :many
SELECT id, run_id, kind, name, properties, created_at
FROM assets
WHERE run_id = $1
ORDER BY created_at;

-- name: CreateObservation :one
INSERT INTO observations (run_id, asset_id, summary, detail, evidence_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, run_id, asset_id, summary, detail, evidence_id, created_at;

-- name: GetObservation :one
SELECT id, run_id, asset_id, summary, detail, evidence_id, created_at
FROM observations
WHERE id = $1;

-- name: ListObservationsByRun :many
SELECT id, run_id, asset_id, summary, detail, evidence_id, created_at
FROM observations
WHERE run_id = $1
ORDER BY created_at;

-- name: CreateHypothesis :one
INSERT INTO hypotheses (run_id, title, description, status)
VALUES ($1, $2, $3, $4)
RETURNING id, run_id, title, description, status, created_at;

-- name: GetHypothesis :one
SELECT id, run_id, title, description, status, created_at
FROM hypotheses
WHERE id = $1;

-- name: UpdateHypothesisStatus :one
UPDATE hypotheses
SET status = $2
WHERE id = $1
RETURNING id, run_id, title, description, status, created_at;

-- name: CreateCoverageEntry :one
INSERT INTO coverage_entries (run_id, hypothesis_id, asset_id, method, outcome, evidence_id, reason)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, run_id, hypothesis_id, asset_id, method, outcome, evidence_id, reason, created_at;

-- name: GetCoverageEntry :one
SELECT id, run_id, hypothesis_id, asset_id, method, outcome, evidence_id, reason, created_at
FROM coverage_entries
WHERE id = $1;

-- name: ListCoverageByRun :many
SELECT id, run_id, hypothesis_id, asset_id, method, outcome, evidence_id, reason, created_at
FROM coverage_entries
WHERE run_id = $1
ORDER BY created_at;
