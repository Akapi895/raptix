-- +goose Up
-- Domain: platform/projects
CREATE TABLE projects (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    status     text NOT NULL DEFAULT 'active',  -- active | archived
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE projects IS 'Project metadata and lifecycle. Owner: platform/projects.';

CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subject    text NOT NULL,   -- principal id (user/group)
    role       text NOT NULL,   -- owner | member | reviewer
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, subject)
);

COMMENT ON TABLE project_members IS 'Project membership. Owner: platform/projects. Persona/agent role does not grant membership here.';

CREATE TABLE scopes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version        integer NOT NULL DEFAULT 1,
    asset_types    text[] NOT NULL DEFAULT '{}',
    include        text[] NOT NULL DEFAULT '{}',
    exclude        text[] NOT NULL DEFAULT '{}',
    expires_at     timestamptz,
    approval_note  text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE scopes IS 'Versioned engagement scope. Owner: platform/projects. New assets do not auto-extend scope.';

-- +goose Down
DROP TABLE IF EXISTS scopes;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
