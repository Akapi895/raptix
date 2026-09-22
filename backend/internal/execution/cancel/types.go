// Package cancel owns the cancellation and reconciliation policy for tool
// invocations. It only touches tool_invocations (the execution domain) and
// never imports engine/runs or engine/agents: cross-module cascade is
// orchestrated at the composition root. The side-effect distinction is central:
// an invocation that never dispatched maps to cancelled, while one that may
// have had an external side effect maps to unknown and must be reconciled.
package cancel

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
)

// Store is the invocation persistence contract the cancel policy needs.
// invocation.Postgres satisfies it; a test double implements it for unit tests.
type Store interface {
	ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]invocation.Invocation, error)
	MarkUnknown(ctx context.Context, id uuid.UUID, version int) (invocation.Invocation, error)
	CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []invocation.Status, to invocation.Status) (int64, error)
}

// CancelReport summarizes a cancellation pass.
type CancelReport struct {
	Cancelled int64 // invocations that never dispatched (side effect not possible)
	Unknown   int64 // invocations that may have acted; outcome unrecorded
}

// ReconcileReport summarizes a reconciliation pass.
type ReconcileReport struct {
	Reconciled int64
	Skipped    int64   // invocations finished concurrently (optimistic-lock conflict)
	Errors     []error // non-fatal per-item errors
}
