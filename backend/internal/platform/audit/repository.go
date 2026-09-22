package audit

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; other packages never import the
// generated store directly.
type Repository interface {
	Insert(ctx context.Context, r Record) (AuditRecord, error)
	GetByID(ctx context.Context, id uuid.UUID) (AuditRecord, error)
	ListByActor(ctx context.Context, actor string) ([]AuditRecord, error)
	ListByCorrelation(ctx context.Context, correlation string) ([]AuditRecord, error)
}
