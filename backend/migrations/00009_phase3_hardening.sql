-- +goose Up
-- Domain: platform/projects
-- Scope versions must be unique per project: CreateScope allocates
-- MAX(version)+1 under a project row lock, and this constraint makes a
-- concurrent duplicate allocation impossible.
ALTER TABLE scopes ADD CONSTRAINT scopes_project_version_unique UNIQUE (project_id, version);
ALTER TABLE scopes ADD CONSTRAINT scopes_version_positive CHECK (version > 0);
ALTER TABLE projects ADD CONSTRAINT projects_status_valid CHECK (status IN ('active', 'archived'));
ALTER TABLE project_members ADD CONSTRAINT project_members_role_valid CHECK (role IN ('owner', 'member', 'reviewer'));

-- Domain: engine/runs
ALTER TABLE runs ADD CONSTRAINT runs_version_positive CHECK (version > 0);
ALTER TABLE runs ADD CONSTRAINT runs_status_valid
    CHECK (status IN ('queued', 'running', 'paused', 'cancelled', 'completed', 'budget_exhausted'));
ALTER TABLE tasks ADD CONSTRAINT tasks_version_positive CHECK (version > 0);
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
    CHECK (status IN ('queued', 'running', 'paused', 'cancelled', 'completed', 'budget_exhausted'));
ALTER TABLE agent_instances ADD CONSTRAINT agent_instances_version_positive CHECK (version > 0);
ALTER TABLE agent_instances ADD CONSTRAINT agent_instances_status_valid
    CHECK (status IN ('paused', 'running', 'completed', 'failed', 'cancelled'));

-- Domain: workspace/evidence
ALTER TABLE artifacts ADD CONSTRAINT artifacts_size_nonnegative CHECK (size >= 0);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_sha256_format
    CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE artifacts ADD CONSTRAINT artifacts_kind_valid CHECK (kind IN ('raw', 'derived'));
ALTER TABLE artifacts ADD CONSTRAINT artifacts_sensitivity_valid
    CHECK (sensitivity IN ('low', 'medium', 'high', 'secret'));
ALTER TABLE artifacts ADD CONSTRAINT artifacts_storage_key_notblank
    CHECK (btrim(storage_key) <> '');
-- Derived artifacts require a parent and a relation type; raw artifacts have neither.
ALTER TABLE artifacts ADD CONSTRAINT artifacts_derived_parent_required
    CHECK ((kind = 'derived' AND parent_id IS NOT NULL AND btrim(rel_type) <> '')
        OR (kind = 'raw' AND parent_id IS NULL));

-- Domain: workspace/findings
ALTER TABLE findings ADD CONSTRAINT findings_version_positive CHECK (version > 0);
ALTER TABLE findings ADD CONSTRAINT findings_status_valid
    CHECK (status IN ('draft', 'reviewed', 'confirmed', 'rejected', 'inconclusive'));
ALTER TABLE findings ADD CONSTRAINT findings_severity_valid
    CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical'));
ALTER TABLE findings ADD CONSTRAINT findings_confidence_valid
    CHECK (confidence IN ('low', 'medium', 'high'));
ALTER TABLE finding_evidence ADD CONSTRAINT finding_evidence_role_valid
    CHECK (role IN ('supporting', 'refuting', 'context'));
ALTER TABLE finding_verdicts ADD CONSTRAINT finding_verdicts_verdict_valid
    CHECK (verdict IN ('confirmed', 'refuted', 'inconclusive'));

-- +goose Down
ALTER TABLE finding_verdicts DROP CONSTRAINT IF EXISTS finding_verdicts_verdict_valid;
ALTER TABLE finding_evidence DROP CONSTRAINT IF EXISTS finding_evidence_role_valid;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_confidence_valid;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_severity_valid;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_status_valid;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_version_positive;

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_derived_parent_required;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_storage_key_notblank;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_sensitivity_valid;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_valid;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_sha256_format;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_size_nonnegative;

ALTER TABLE agent_instances DROP CONSTRAINT IF EXISTS agent_instances_status_valid;
ALTER TABLE agent_instances DROP CONSTRAINT IF EXISTS agent_instances_version_positive;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_valid;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_version_positive;
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_valid;
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_version_positive;

ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_valid;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_valid;
ALTER TABLE scopes DROP CONSTRAINT IF EXISTS scopes_version_positive;
ALTER TABLE scopes DROP CONSTRAINT IF EXISTS scopes_project_version_unique;
