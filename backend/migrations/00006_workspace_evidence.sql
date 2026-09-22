-- +goose Up
-- Domain: workspace/evidence
CREATE TABLE artifacts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        uuid REFERENCES runs(id) ON DELETE SET NULL,
    kind          text NOT NULL,            -- raw | derived
    mime          text NOT NULL DEFAULT 'application/octet-stream',
    size          bigint NOT NULL DEFAULT 0,
    sha256        text NOT NULL,
    schema_version text NOT NULL DEFAULT '',
    parser_version text NOT NULL DEFAULT '',
    sensitivity   text NOT NULL DEFAULT 'low',  -- low | medium | high | secret
    storage_key   text NOT NULL,            -- key into filesystem/object storage adapter
    rel_type       text NOT NULL DEFAULT '',  -- for derived: relation to raw artifact
    parent_id      uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX artifacts_run_idx ON artifacts (run_id, created_at DESC);
CREATE INDEX artifacts_parent_idx ON artifacts (parent_id);

COMMENT ON TABLE artifacts IS 'Artifact metadata and provenance. Owner: workspace/evidence. Bytes live in the storage adapter; this table holds metadata.';

-- +goose Down
DROP TABLE IF EXISTS artifacts;
