-- +goose Up
-- Domain: workspace/reporting
CREATE TABLE report_requests (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    template_id        text NOT NULL,
    template_version   text NOT NULL,
    template_hash      text NOT NULL,
    snapshot           jsonb NOT NULL,
    status             text NOT NULL DEFAULT 'queued',
    version            integer NOT NULL DEFAULT 1,
    lease_owner        text,
    lease_expires_at   timestamptz,
    output_artifact_id uuid REFERENCES artifacts(id) ON DELETE RESTRICT,
    failure_code       text NOT NULL DEFAULT '',
    failure_message    text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id),
    CHECK (template_id <> ''),
    CHECK (template_version <> ''),
    CHECK (template_hash ~ '^[0-9a-f]{64}$'),
    CHECK (jsonb_typeof(snapshot) = 'object'),
    CHECK (status IN ('queued', 'rendering', 'completed', 'failed', 'cancelled')),
    CHECK (version > 0),
    CHECK (
        (status = 'rendering' AND lease_owner IS NOT NULL AND lease_owner <> '' AND lease_expires_at IS NOT NULL)
        OR (status <> 'rendering' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CHECK ((status = 'completed') = (output_artifact_id IS NOT NULL))
);

CREATE INDEX report_requests_claim_idx
    ON report_requests (status, lease_expires_at)
    WHERE status IN ('queued', 'rendering');

-- +goose StatementBegin
CREATE FUNCTION workspace_reporting_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    artifact_run_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.template_id IS DISTINCT FROM OLD.template_id
        OR NEW.template_version IS DISTINCT FROM OLD.template_version
        OR NEW.template_hash IS DISTINCT FROM OLD.template_hash
        OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    ) THEN
        RAISE EXCEPTION 'report request input snapshot and template are immutable';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.output_artifact_id IS NOT NULL
       AND NEW.output_artifact_id IS DISTINCT FROM OLD.output_artifact_id THEN
        RAISE EXCEPTION 'report output artifact is immutable once linked';
    END IF;

    IF NEW.output_artifact_id IS NOT NULL THEN
        SELECT run_id INTO artifact_run_id FROM artifacts WHERE id = NEW.output_artifact_id;
        IF NOT FOUND OR artifact_run_id IS DISTINCT FROM NEW.run_id THEN
            RAISE EXCEPTION 'report output artifact must belong to the report run';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER report_requests_guard
    BEFORE INSERT OR UPDATE ON report_requests
    FOR EACH ROW EXECUTE FUNCTION workspace_reporting_guard();

COMMENT ON TABLE report_requests IS 'Immutable report input snapshots and report publication lifecycle. Owner: workspace/reporting.';
COMMENT ON COLUMN report_requests.snapshot IS 'Immutable JSON report input snapshot captured at request creation.';
COMMENT ON COLUMN report_requests.output_artifact_id IS 'The single evidence artifact published for the completed report.';

-- +goose Down
DROP TRIGGER IF EXISTS report_requests_guard ON report_requests;
DROP FUNCTION IF EXISTS workspace_reporting_guard();
DROP INDEX IF EXISTS report_requests_claim_idx;
DROP TABLE IF EXISTS report_requests;
