package findings

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Service enforces finding lifecycle and status transitions. It is the only
// place that changes a finding's status; RecordVerdict records verification
// output without altering status.
type Service struct {
	repo Repository
}

// NewService wires a findings service over a repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

var transitions = map[FindingStatus][]FindingStatus{
	StatusDraft:        {StatusReviewed},
	StatusReviewed:     {StatusConfirmed, StatusRejected, StatusInconclusive, StatusReviewed},
	StatusConfirmed:    {StatusReviewed},
	StatusRejected:     {StatusReviewed},
	StatusInconclusive: {StatusReviewed},
}

// CreateFinding validates inputs and creates a new draft.
func (s *Service) CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error) {
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" {
		return Finding{}, fmt.Errorf("finding title must not be empty")
	}
	switch p.Severity {
	case SeverityNone, SeverityLow, SeverityMedium, SeverityHigh, SeverityCritical:
	default:
		return Finding{}, fmt.Errorf("invalid severity %q", p.Severity)
	}
	switch p.Confidence {
	case ConfidenceLow, ConfidenceMedium, ConfidenceHigh:
	default:
		return Finding{}, fmt.Errorf("invalid confidence %q", p.Confidence)
	}
	return s.repo.CreateFinding(ctx, p)
}

// TransitionStatus is the only API that changes a finding's status. It moves to
// the new status at the given version and records the review history step as
// one atomic operation: the status/version change and its history row cannot
// diverge, even on partial failure.
func (s *Service) TransitionStatus(ctx context.Context, id uuid.UUID, version int, to FindingStatus, reviewer, reason string) (Finding, error) {
	reviewer = strings.TrimSpace(reviewer)
	if reviewer == "" {
		return Finding{}, fmt.Errorf("finding reviewer must not be empty")
	}
	current, err := s.repo.GetFinding(ctx, id)
	if err != nil {
		return Finding{}, err
	}
	// The legality check is evaluated against current.Status, so the caller's
	// version must match the version it read. Otherwise a caller could pass a
	// version that matches the database while its status view is stale, and the
	// transition would bypass the table above.
	if version != current.Version {
		return Finding{}, &ErrOptimisticLock{ID: id}
	}
	if !canTransition(current.Status, to) {
		return Finding{}, &ErrIllegalTransition{From: current.Status, To: to}
	}
	return s.repo.TransitionFindingWithHistory(ctx, id, version, to, reviewer, reason)
}

func canTransition(from, to FindingStatus) bool {
	for _, allowed := range transitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

// RecordVerdict stores a verifier-produced verdict. It deliberately does not
// change the finding status; only TransitionStatus may do that.
func (s *Service) RecordVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error) {
	if p.ProducedBy == "" {
		return FindingVerdict{}, fmt.Errorf("verdict producer must not be empty")
	}
	switch p.Verdict {
	case VerdictConfirmed, VerdictRefuted, VerdictInconclusive:
	default:
		return FindingVerdict{}, fmt.Errorf("invalid verdict %q", p.Verdict)
	}
	return s.repo.InsertVerdict(ctx, p)
}

// LinkEvidence associates an evidence artifact with a finding. An empty role
// defaults to "supporting"; any other role must be one of the known values.
// Re-linking the same evidence updates its role rather than failing.
func (s *Service) LinkEvidence(ctx context.Context, findingID, evidenceID uuid.UUID, role string) error {
	if findingID == uuid.Nil || evidenceID == uuid.Nil {
		return fmt.Errorf("finding and evidence ids are required")
	}
	role = strings.TrimSpace(role)
	if role == "" {
		role = "supporting"
	}
	switch role {
	case "supporting", "refuting", "context":
	default:
		return fmt.Errorf("invalid evidence role %q", role)
	}
	return s.repo.LinkEvidence(ctx, EvidenceLink{FindingID: findingID, EvidenceID: evidenceID, Role: role})
}

// ListVerdicts returns the recorded verdicts for a finding (newest first).
func (s *Service) ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error) {
	return s.repo.ListVerdicts(ctx, findingID)
}

// ListReviewHistory returns the transition history (newest first).
func (s *Service) ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error) {
	return s.repo.ListReviewHistory(ctx, findingID)
}

// GetFinding returns a finding by id.
func (s *Service) GetFinding(ctx context.Context, id uuid.UUID) (Finding, error) {
	return s.repo.GetFinding(ctx, id)
}
