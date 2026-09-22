package app

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/cancel"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
)

// CancelRunResult is the aggregate outcome of cancelling a run across the
// modules that own pieces of its lifecycle.
type CancelRunResult struct {
	RunID             uuid.UUID
	TasksCancelled    int
	AgentsCancelled   int
	AttemptsCancelled int
	InvsCancelled     int64
	InvsUnknown       int64
}

// CancelRun cancels a run and everything under it. Each module transitions the
// state it owns: engine/runs cancels the run, tasks and agent instances;
// engine/agents cancels running attempts; execution/cancel moves non-terminal
// invocations to cancelled (not yet dispatched) or unknown (may have had side
// effects). The decision is recorded in the audit log.
func (s *Services) CancelRun(ctx context.Context, runID uuid.UUID) (CancelRunResult, error) {
	if runID == uuid.Nil {
		return CancelRunResult{}, fmt.Errorf("run id is required")
	}
	run, err := s.Runs.GetRun(ctx, runID)
	if err != nil {
		return CancelRunResult{}, err
	}

	runsRes, err := s.Runs.CancelRun(ctx, runID)
	if err != nil {
		return CancelRunResult{}, err
	}

	out := CancelRunResult{
		RunID:           runID,
		TasksCancelled:  runsRes.TasksCancelled,
		AgentsCancelled: runsRes.AgentsCancelled,
	}

	// Re-list after the lifecycle transition: once the run is cancelled no new
	// agent can be created, so this list is complete and no running attempt is
	// left behind by a concurrent agent creation.
	agents, err := s.Runs.ListAgentsByRun(ctx, runID)
	if err != nil {
		return out, err
	}
	for _, a := range agents {
		n, err := s.Agents.CancelRunningAttempts(ctx, a.ID)
		if err != nil {
			return out, err
		}
		out.AttemptsCancelled += n
	}

	if s.cancel != nil {
		crep, err := s.cancel.CancelRun(ctx, runID)
		if err != nil {
			return out, err
		}
		out.InvsCancelled = crep.Cancelled
		out.InvsUnknown = crep.Unknown
	}

	// Audit the decision (allow); actor defaults to the run's creator so a
	// system-initiated cancel remains traceable.
	actor := auditActor(run.CreatedBy)
	if _, err := s.Audit.Record(ctx, audit.Record{
		Actor:       actor,
		Action:      "run.cancel",
		Resource:    runID.String(),
		Outcome:     audit.OutcomeAllowed,
		Reason:      "run, tasks, agents, attempts and invocations cancelled",
		Correlation: runID.String(),
	}); err != nil {
		return out, fmt.Errorf("cancel recorded but audit failed: %w", err)
	}
	return out, nil
}

// Reconcile marks non-terminal invocations older than the configured threshold
// as unknown, reconciling after a crash or restart. It never re-dispatches and
// never overrides a result that finished concurrently.
func (s *Services) Reconcile(ctx context.Context) (cancel.ReconcileReport, error) {
	if s.cancel == nil {
		return cancel.ReconcileReport{}, fmt.Errorf("reconcile service not wired")
	}
	return s.cancel.Reconcile(ctx, s.reconcileStaleAfter)
}
