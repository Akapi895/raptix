package app

import (
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/filesystem"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/postgres"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/workspace/assessment"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

// Services exposes the Phase 3 business services wired through the composition
// root. Handlers and entrypoints use these; they never import a module store.
type Services struct {
	Projects   *projects.Service
	Governance *governance.Service
	Audit      *audit.Service
	Runs       *runs.Service
	Evidence   *evidence.Service
	Assessment *assessment.Service
	Findings   *findings.Service
}

// wireServices builds each module Postgres-backed repository over the shared
// pool and returns the composed services. The pool is lazy, so this succeeds
// before the database is reachable; running a query still requires connectivity.
//
// Cross-module wiring follows the ownership rules: governance learns about
// scope validity through the projects service contract (never by querying the
// projects/scopes tables), and evidence persists bytes through the filesystem
// store rather than trusting caller-supplied checksums.
func wireServices(pool *postgres.Pool, fs *filesystem.Store) *Services {
	dbtx := pool.DB()
	projectSvc := projects.NewService(projects.NewPostgres(dbtx))
	return &Services{
		Projects:   projectSvc,
		Governance: governance.NewService(governance.NewPostgres(dbtx), projectSvc),
		Audit:      audit.NewService(audit.NewPostgres(dbtx)),
		Runs:       runs.NewService(runs.NewPostgres(dbtx)),
		Evidence:   evidence.NewService(evidence.NewPostgres(dbtx), fs),
		Assessment: assessment.NewService(assessment.NewPostgres(dbtx)),
		Findings:   findings.NewService(findings.NewPostgres(dbtx)),
	}
}
