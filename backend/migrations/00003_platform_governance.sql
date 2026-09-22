-- +goose Up
-- Domain: platform/governance
CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE,     -- e.g. project_owner, reviewer
    description text NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name    text NOT NULL UNIQUE,         -- e.g. run.start, finding.review
    comment text NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
    role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id  uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE capability_grants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject     text NOT NULL,               -- principal id
    scope_id    uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    capability  text NOT NULL,               -- tool id or action
    granted_by  text NOT NULL,               -- principal who granted
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,
    expires_at  timestamptz
);

COMMENT ON TABLE capability_grants IS 'Capability grants. Owner: platform/governance. Grant is checked against current scope at dispatch time; snapshot does not override later revocation.';

CREATE TABLE approvals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject     text NOT NULL,
    scope_id    uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    action      text NOT NULL,               -- e.g. run.high_risk
    status      text NOT NULL DEFAULT 'pending',  -- pending | approved | denied | superseded
    decided_by  text,
    decided_at  timestamptz,
    reason      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz
);

-- +goose Down
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS capability_grants;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
