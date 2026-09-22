package audit

import (
	"context"
	"fmt"
	"strings"
)

// Service exposes audit operations with business rules enforced here.
type Service struct {
	repo Repository
}

// NewService wires an audit service over a repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Record validates and persists an audit entry.
func (s *Service) Record(ctx context.Context, rec Record) (AuditRecord, error) {
	rec.Actor = strings.TrimSpace(rec.Actor)
	rec.Action = strings.TrimSpace(rec.Action)
	if rec.Actor == "" {
		return AuditRecord{}, fmt.Errorf("audit actor must not be empty")
	}
	if rec.Action == "" {
		return AuditRecord{}, fmt.Errorf("audit action must not be empty")
	}
	switch rec.Outcome {
	case OutcomeAllowed, OutcomeDenied, OutcomeError:
	default:
		return AuditRecord{}, fmt.Errorf("invalid audit outcome %q", rec.Outcome)
	}
	return s.repo.Insert(ctx, rec)
}
