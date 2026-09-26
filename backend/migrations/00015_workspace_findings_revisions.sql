-- +goose Up
-- Domain: workspace/findings
CREATE TABLE finding_revisions (
    finding_id    uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    revision_no   integer NOT NULL CHECK (revision_no > 0),
    title         text NOT NULL,
    description   text NOT NULL DEFAULT '',
    severity      text NOT NULL,
    confidence    text NOT NULL,
    status        text NOT NULL,
    change_reason text NOT NULL DEFAULT '',
    actor         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (finding_id, revision_no),
    CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')),
    CHECK (confidence IN ('low', 'medium', 'high')),
    CHECK (status IN ('draft', 'reviewed', 'confirmed', 'rejected', 'inconclusive'))
);

CREATE TABLE finding_revision_evidence (
    finding_id  uuid NOT NULL,
    revision_no integer NOT NULL,
    evidence_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
    role        text NOT NULL,
    PRIMARY KEY (finding_id, revision_no, evidence_id),
    FOREIGN KEY (finding_id, revision_no)
        REFERENCES finding_revisions(finding_id, revision_no) ON DELETE CASCADE,
    CHECK (role IN ('supporting', 'refuting', 'context'))
);

-- +goose StatementBegin
CREATE FUNCTION workspace_findings_revisions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'finding revision snapshots are immutable';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER finding_revisions_immutable
    BEFORE UPDATE ON finding_revisions
    FOR EACH ROW EXECUTE FUNCTION workspace_findings_revisions_immutable();
CREATE TRIGGER finding_revision_evidence_immutable
    BEFORE UPDATE ON finding_revision_evidence
    FOR EACH ROW EXECUTE FUNCTION workspace_findings_revisions_immutable();

ALTER TABLE finding_verdicts ADD COLUMN revision_no integer;
ALTER TABLE finding_verdicts ADD COLUMN legacy boolean NOT NULL DEFAULT false;
ALTER TABLE finding_verdicts ADD CONSTRAINT finding_verdicts_revision_fkey
    FOREIGN KEY (finding_id, revision_no)
    REFERENCES finding_revisions(finding_id, revision_no);

ALTER TABLE finding_review_history ADD COLUMN from_revision_no integer;
ALTER TABLE finding_review_history ADD COLUMN to_revision_no integer;
ALTER TABLE finding_review_history ADD COLUMN legacy boolean NOT NULL DEFAULT false;
ALTER TABLE finding_review_history ADD CONSTRAINT finding_review_history_from_revision_fkey
    FOREIGN KEY (finding_id, from_revision_no)
    REFERENCES finding_revisions(finding_id, revision_no);
ALTER TABLE finding_review_history ADD CONSTRAINT finding_review_history_to_revision_fkey
    FOREIGN KEY (finding_id, to_revision_no)
    REFERENCES finding_revisions(finding_id, revision_no);

-- Phase 3 stored only the current aggregate and current evidence links. Preserve
-- that known state as one explicit baseline; prior history cannot be reconstructed.
INSERT INTO finding_revisions (
    finding_id, revision_no, title, description, severity, confidence, status,
    change_reason, actor
)
SELECT id, 1, title, description, severity, confidence, status,
       'legacy baseline', 'migration'
FROM findings;

INSERT INTO finding_revision_evidence (finding_id, revision_no, evidence_id, role)
SELECT finding_id, 1, evidence_id, role
FROM finding_evidence;

-- Existing verdicts and review rows predate revision binding. Null revision
-- references plus legacy=true preserve them without inventing a source revision.
UPDATE finding_verdicts SET legacy = true WHERE revision_no IS NULL;
UPDATE finding_review_history SET legacy = true
WHERE from_revision_no IS NULL OR to_revision_no IS NULL;

CREATE INDEX finding_revisions_finding_created_idx
    ON finding_revisions (finding_id, revision_no DESC, created_at DESC);
CREATE INDEX finding_revision_evidence_revision_idx
    ON finding_revision_evidence (finding_id, revision_no);
CREATE INDEX finding_verdicts_revision_idx
    ON finding_verdicts (finding_id, revision_no, created_at DESC) WHERE revision_no IS NOT NULL;
CREATE INDEX finding_review_history_to_revision_idx
    ON finding_review_history (finding_id, to_revision_no, created_at DESC) WHERE to_revision_no IS NOT NULL;

COMMENT ON TABLE finding_revisions IS 'Immutable finding content/status snapshots. Owner: workspace/findings.';
COMMENT ON TABLE finding_revision_evidence IS 'Immutable evidence membership snapshot for one finding revision.';
COMMENT ON COLUMN finding_verdicts.revision_no IS 'Verified revision; NULL only for legacy rows with unavailable source revision.';
COMMENT ON COLUMN finding_review_history.from_revision_no IS 'Pre-decision revision; NULL only for legacy rows with unavailable source revision.';
COMMENT ON COLUMN finding_review_history.to_revision_no IS 'Post-decision revision; NULL only for legacy rows with unavailable source revision.';

-- +goose Down
DROP INDEX IF EXISTS finding_review_history_to_revision_idx;
DROP INDEX IF EXISTS finding_verdicts_revision_idx;
DROP INDEX IF EXISTS finding_revision_evidence_revision_idx;
DROP INDEX IF EXISTS finding_revisions_finding_created_idx;

ALTER TABLE finding_review_history DROP CONSTRAINT IF EXISTS finding_review_history_to_revision_fkey;
ALTER TABLE finding_review_history DROP CONSTRAINT IF EXISTS finding_review_history_from_revision_fkey;
ALTER TABLE finding_review_history DROP COLUMN IF EXISTS legacy;
ALTER TABLE finding_review_history DROP COLUMN IF EXISTS to_revision_no;
ALTER TABLE finding_review_history DROP COLUMN IF EXISTS from_revision_no;

ALTER TABLE finding_verdicts DROP CONSTRAINT IF EXISTS finding_verdicts_revision_fkey;
ALTER TABLE finding_verdicts DROP COLUMN IF EXISTS legacy;
ALTER TABLE finding_verdicts DROP COLUMN IF EXISTS revision_no;

DROP TRIGGER IF EXISTS finding_revision_evidence_immutable ON finding_revision_evidence;
DROP TRIGGER IF EXISTS finding_revisions_immutable ON finding_revisions;
DROP FUNCTION IF EXISTS workspace_findings_revisions_immutable();

DROP TABLE IF EXISTS finding_revision_evidence;
DROP TABLE IF EXISTS finding_revisions;
