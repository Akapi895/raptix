package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/google/uuid"
)

// CapabilityRunStart is the governance capability a project member must hold
// (as an active grant within the engagement scope) before a run may be started.
const CapabilityRunStart = "run.start"

// StartRunParams carries the caller-provided, already-authenticated request to
// create a run. Scope is the engagement scope the run operates under.
type StartRunParams struct {
	ProjectID uuid.UUID
	ScopeID   uuid.UUID
	Actor     string
	Name      string
}

// ErrRunUnauthorized reports that a run start was denied by the minimum
// permission model. It is returned through StartAuthorizedRun and never writes
// a lifecycle row.
type ErrRunUnauthorized struct{ Reason string }

func (e *ErrRunUnauthorized) Error() string { return "run start denied: " + e.Reason }

// StartAuthorizedRun is the Phase 3 entry point for creating a run. It enforces
// the minimum permission model before any lifecycle row is written:
//
//   - the project must exist and be active
//   - the scope must belong to the project and still be valid
//   - the actor must be a project member
//   - the actor must hold an active governance grant for CapabilityRunStart
//
// Every decision (allow or deny) is recorded in the audit log; allowed decisions
// use the created run id as the correlation key so a run is traceable to the
// permits that authorized it.
func (s *Services) StartAuthorizedRun(ctx context.Context, p StartRunParams) (runs.Run, error) {
	p.Actor = strings.TrimSpace(p.Actor)
	p.Name = strings.TrimSpace(p.Name)
	denied := func(reason string) (runs.Run, error) {
		_, _ = s.Audit.Record(ctx, audit.Record{
			Actor:       auditActor(p.Actor),
			Action:      "run.start",
			Resource:    p.ScopeID.String(),
			Outcome:     audit.OutcomeDenied,
			Reason:      reason,
			Correlation: p.ProjectID.String(),
		})
		return runs.Run{}, &ErrRunUnauthorized{Reason: reason}
	}
	if p.Actor == "" {
		return denied("actor is required")
	}
	if p.Name == "" {
		return denied("run name is required")
	}
	if p.ProjectID == uuid.Nil || p.ScopeID == uuid.Nil {
		return denied("project and scope are required")
	}

	project, err := s.Projects.GetProjectByID(ctx, p.ProjectID)
	if err != nil {
		return denied(fmt.Sprintf("project %s is not available", p.ProjectID))
	}
	if project.Status != projects.ProjectActive {
		return denied(fmt.Sprintf("project %s is not active", p.ProjectID))
	}

	scope, err := s.Projects.GetScope(ctx, p.ScopeID)
	if err != nil {
		return denied(fmt.Sprintf("scope %s is not available", p.ScopeID))
	}
	if scope.ProjectID != p.ProjectID {
		return denied("scope does not belong to the project")
	}
	scopeOK, err := s.Projects.IsScopeActive(ctx, p.ScopeID)
	if err != nil {
		return denied("could not validate scope")
	}
	if !scopeOK {
		return denied("scope has expired")
	}

	role, err := s.Projects.GetMemberRole(ctx, p.ProjectID, p.Actor)
	if err != nil {
		return denied("could not validate membership")
	}
	if role == "" {
		return denied(fmt.Sprintf("%s is not a member of project %s", p.Actor, p.ProjectID))
	}

	ok, err := s.Governance.CheckActiveGrant(ctx, p.Actor, p.ScopeID, CapabilityRunStart)
	if err != nil {
		return denied("could not evaluate governance grant")
	}
	if !ok {
		return denied(fmt.Sprintf("%s has no active %s grant in scope %s", p.Actor, CapabilityRunStart, p.ScopeID))
	}

	run, err := s.Runs.StartRun(ctx, p.ProjectID, p.Name, p.Actor)
	if err != nil {
		return runs.Run{}, err
	}
	if _, err := s.Audit.Record(ctx, audit.Record{
		Actor:       p.Actor,
		Action:      "run.start",
		Resource:    p.ScopeID.String(),
		Outcome:     audit.OutcomeAllowed,
		Reason:      fmt.Sprintf("scope %s grant %s", p.ScopeID, CapabilityRunStart),
		Correlation: run.ID.String(),
	}); err != nil {
		// The run exists; return it alongside the error so a caller does not
		// retry and create a duplicate. The missing audit entry is surfaced,
		// not swallowed.
		return run, fmt.Errorf("run %s started but its audit record failed: %w", run.ID, err)
	}
	return run, nil
}

// auditActor substitutes a placeholder for an empty actor so an input-validation
// denial is still recorded (audit.Record rejects an empty actor).
func auditActor(actor string) string {
	if actor == "" {
		return "unknown"
	}
	return actor
}
