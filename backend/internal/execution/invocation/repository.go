package invocation

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; other modules never import the
// generated store directly.
type Repository interface {
	CreateInvocation(ctx context.Context, p CreateParams) (Invocation, error)
	GetInvocation(ctx context.Context, id uuid.UUID) (Invocation, error)
	GetByRunAndIdempotencyKey(ctx context.Context, runID uuid.UUID, key string) (Invocation, error)
	UpdateResult(ctx context.Context, u ResultUpdate) (Invocation, error)
	StartInvocation(ctx context.Context, id uuid.UUID, version int) (Invocation, error)
	MarkUnknown(ctx context.Context, id uuid.UUID, version int) (Invocation, error)
	ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]Invocation, error)
	CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []Status, to Status) (int64, error)
	CountByRun(ctx context.Context, runID uuid.UUID) (int64, error)
	ListByRun(ctx context.Context, runID uuid.UUID) ([]Invocation, error)
}
