-- +goose Up
-- Domain: platform/audit
CREATE TABLE audit_records (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor       text NOT NULL,               -- principal id
    action      text NOT NULL,               -- e.g. grant.capability, run.create
    resource    text NOT NULL DEFAULT '',    -- resource id/reference
    outcome     text NOT NULL,               -- allowed | denied | error
    reason      text NOT NULL DEFAULT '',
    correlation text NOT NULL DEFAULT '',    -- run/request correlation id
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_records_actor_idx ON audit_records (actor, created_at DESC);
CREATE INDEX audit_records_correlation_idx ON audit_records (correlation);
CREATE INDEX audit_records_resource_idx ON audit_records (resource);

COMMENT ON TABLE audit_records IS 'Business audit history, distinct from application telemetry. Owner: platform/audit.';

-- +goose Down
DROP TABLE IF EXISTS audit_records;
