-- +goose Up
-- Domain: workspace/findings
CREATE TABLE findings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    severity    text NOT NULL DEFAULT 'medium',   -- none | low | medium | high | critical
    confidence  text NOT NULL DEFAULT 'low',      -- low | medium | high
    status      text NOT NULL DEFAULT 'draft',    -- draft | reviewed | confirmed | rejected | inconclusive
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE findings IS 'Finding aggregate. Owner: workspace/findings (only owner of status transition).';

CREATE TABLE finding_evidence (
    finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    evidence_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'supporting',  -- supporting | refuting | context
    PRIMARY KEY (finding_id, evidence_id)
);

CREATE TABLE finding_verdicts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id    uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    verdict       text NOT NULL,               -- confirmed | refuted | inconclusive
    reason        text NOT NULL DEFAULT '',
    produced_by   text NOT NULL DEFAULT '',    -- verifier id; does not change status
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finding_verdicts IS 'Verifier output. Owner: workspace/findings records it; verifier must not flip finding.status directly.';

CREATE TABLE finding_review_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id  uuid NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    from_status text NOT NULL,
    to_status   text NOT NULL,
    reviewer    text NOT NULL,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE finding_review_history IS 'Review history for status transitions. Owner: workspace/findings.';

-- +goose Down
DROP TABLE IF EXISTS finding_review_history;
DROP TABLE IF EXISTS finding_verdicts;
DROP TABLE IF EXISTS finding_evidence;
DROP TABLE IF EXISTS findings;
