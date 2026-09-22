-- +goose Up
-- Phase 3 correctness fixes surfaced by review.

-- 1. Scope version allocation must be atomic. A MAX(version)+1 computed inside
-- the same READ COMMITTED statement as its FOR UPDATE lock can miss a row a
-- concurrent transaction just committed, so use a monotonic counter on the
-- project row instead (an UPDATE re-reads the latest row after the lock wait).
ALTER TABLE projects ADD COLUMN scope_version integer NOT NULL DEFAULT 0;

-- 2. A derived artifact requires a parent, so ON DELETE SET NULL would create a
-- derived row with no parent and then fail the CHECK. RESTRICT keeps provenance
-- intact and makes deleting a parent with children an explicit decision.
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_parent_id_fkey;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES artifacts(id) ON DELETE RESTRICT;

-- 3. Raw artifacts must not carry a relation type (only derived ones do).
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_derived_parent_required;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_derived_parent_required
    CHECK ((kind = 'derived' AND parent_id IS NOT NULL AND btrim(rel_type) <> '')
        OR (kind = 'raw' AND parent_id IS NULL AND btrim(rel_type) = ''));

-- 4. Audit outcomes are a finite domain.
ALTER TABLE audit_records ADD CONSTRAINT audit_records_outcome_valid
    CHECK (outcome IN ('allowed', 'denied', 'error'));

-- 5. Indexes for the query patterns Phase 3 actually uses.
CREATE INDEX artifacts_sha256_idx ON artifacts (sha256, created_at DESC, id DESC);
CREATE INDEX runs_project_idx ON runs (project_id, created_at DESC);
CREATE INDEX tasks_run_idx ON tasks (run_id);
CREATE INDEX agent_instances_run_idx ON agent_instances (run_id);
CREATE INDEX capability_grants_subject_scope_idx ON capability_grants (subject, scope_id) WHERE revoked_at IS NULL;
CREATE INDEX assets_run_idx ON assets (run_id, created_at);
CREATE INDEX observations_run_idx ON observations (run_id, created_at);
CREATE INDEX hypotheses_run_idx ON hypotheses (run_id);
CREATE INDEX coverage_entries_run_idx ON coverage_entries (run_id, created_at);
CREATE INDEX findings_run_idx ON findings (run_id, created_at);
CREATE INDEX finding_verdicts_finding_idx ON finding_verdicts (finding_id, created_at DESC, id DESC);
CREATE INDEX finding_review_history_finding_idx ON finding_review_history (finding_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS finding_review_history_finding_idx;
DROP INDEX IF EXISTS finding_verdicts_finding_idx;
DROP INDEX IF EXISTS findings_run_idx;
DROP INDEX IF EXISTS coverage_entries_run_idx;
DROP INDEX IF EXISTS hypotheses_run_idx;
DROP INDEX IF EXISTS observations_run_idx;
DROP INDEX IF EXISTS assets_run_idx;
DROP INDEX IF EXISTS capability_grants_subject_scope_idx;
DROP INDEX IF EXISTS agent_instances_run_idx;
DROP INDEX IF EXISTS tasks_run_idx;
DROP INDEX IF EXISTS runs_project_idx;
DROP INDEX IF EXISTS artifacts_sha256_idx;

ALTER TABLE audit_records DROP CONSTRAINT IF EXISTS audit_records_outcome_valid;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_derived_parent_required;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_derived_parent_required
    CHECK ((kind = 'derived' AND parent_id IS NOT NULL AND btrim(rel_type) <> '')
        OR (kind = 'raw' AND parent_id IS NULL));

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_parent_id_fkey;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES artifacts(id) ON DELETE SET NULL;

ALTER TABLE projects DROP COLUMN IF EXISTS scope_version;
