package cancel

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
)

// Service implements the cancellation and reconciliation policy.
type Service struct {
	store Store
	log   *slog.Logger
}

// NewService wires a cancel/reconcile service over the invocation store.
func NewService(store Store, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, log: log}
}

// CancelRun transitions the run's non-terminal invocations: those that never
// dispatched (pending/dispatched) become cancelled; those that were running may
// have had a side effect, so they become unknown. Terminal states are untouched.
func (s *Service) CancelRun(ctx context.Context, runID uuid.UUID) (CancelReport, error) {
	cancelled, err := s.store.CancelInvocationsByRun(ctx, runID,
		[]invocation.Status{invocation.StatusPending, invocation.StatusDispatched}, invocation.StatusCancelled)
	if err != nil {
		return CancelReport{}, err
	}
	unknown, err := s.store.CancelInvocationsByRun(ctx, runID,
		[]invocation.Status{invocation.StatusRunning}, invocation.StatusUnknown)
	if err != nil {
		return CancelReport{}, err
	}
	return CancelReport{Cancelled: cancelled, Unknown: unknown}, nil
}

// Reconcile marks stale (non-terminal, older than olderThan) invocations as
// unknown so a restart never silently reports success or re-runs them. It is
// optimistic-lock safe: an invocation that finished while reconciling is
// skipped rather than overwritten. Non-fatal per-item errors are collected.
func (s *Service) Reconcile(ctx context.Context, olderThan time.Duration) (ReconcileReport, error) {
	if olderThan <= 0 {
		return ReconcileReport{}, errors.New("reconcile staleness threshold must be positive")
	}
	cutoff := time.Now().UTC().Add(-olderThan)
	stale, err := s.store.ListStaleInvocations(ctx, cutoff)
	if err != nil {
		return ReconcileReport{}, err
	}

	report := ReconcileReport{}
	for _, inv := range stale {
		if ctx.Err() != nil {
			return report, ctx.Err()
		}
		if _, err := s.store.MarkUnknown(ctx, inv.ID, inv.Version); err != nil {
			var lock *invocation.ErrOptimisticLock
			if errors.As(err, &lock) {
				report.Skipped++
				continue
			}
			s.log.Warn("reconcile invocation failed", "invocation", inv.ID, "error", err)
			report.Errors = append(report.Errors, err)
			continue
		}
		report.Reconciled++
	}
	return report, nil
}
