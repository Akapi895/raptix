-- +goose Up
-- Domain: workspace/assessment
CREATE TABLE assets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind        text NOT NULL,               -- host | service | endpoint | ...
    name        text NOT NULL,
    properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE assets IS 'Attack-surface asset. Owner: workspace/assessment. Model must extend beyond URL/HTTP.';

CREATE TABLE observations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    asset_id    uuid REFERENCES assets(id) ON DELETE SET NULL,
    summary     text NOT NULL,
    detail      text NOT NULL DEFAULT '',
    evidence_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE observations IS 'Observed response/behavior. Owner: workspace/assessment. Accepted observations live here, not in evidence.';

CREATE TABLE hypotheses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'open',  -- open | investigating | confirmed | refuted | inconclusive
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coverage_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    hypothesis_id uuid REFERENCES hypotheses(id) ON DELETE SET NULL,
    asset_id    uuid REFERENCES assets(id) ON DELETE SET NULL,
    method      text NOT NULL,
    outcome     text NOT NULL,               -- attempted | not_attempted | inconclusive | verified_negative
    evidence_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coverage_entries IS 'Track what was checked, method, outcome, limits. Owner: workspace/assessment. budget_exhausted should not mark as verified.';

-- +goose Down
DROP TABLE IF EXISTS coverage_entries;
DROP TABLE IF EXISTS hypotheses;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS assets;
