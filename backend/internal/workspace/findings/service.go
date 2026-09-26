package findings

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Service enforces finding lifecycle, revisions, and status transitions. It is
// the only place that changes a finding's status; RecordVerdict records
// verification output without altering status.
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
	if err := validateContent(&p.Title, p.Severity, p.Confidence); err != nil {
		return Finding{}, err
	}
	for i := range p.Evidence {
		p.Evidence[i].Role = strings.TrimSpace(p.Evidence[i].Role)
	}
	if err := validateEvidence(p.Evidence); err != nil {
		return Finding{}, err
	}
	p.Reason = strings.TrimSpace(p.Reason)
	p.Actor = strings.TrimSpace(p.Actor)
	if p.Reason == "" {
		p.Reason = "initial draft"
	}
	if p.Actor == "" {
		p.Actor = "system"
	}
	return s.repo.CreateFinding(ctx, p)
}

// ReviseFinding replaces the mutable content and complete live evidence set at
// ExpectedVersion, creating a new immutable revision without changing status.
func (s *Service) ReviseFinding(ctx context.Context, p ReviseFindingParams) (Finding, error) {
	if p.FindingID == uuid.Nil {
		return Finding{}, fmt.Errorf("finding id is required")
	}
	if p.ExpectedVersion <= 0 {
		return Finding{}, fmt.Errorf("expected finding version must be positive")
	}
	if err := validateContent(&p.Title, p.Severity, p.Confidence); err != nil {
		return Finding{}, err
	}
	if err := validateRevisionMetadata(p.Reason, p.Actor); err != nil {
		return Finding{}, err
	}
	for i := range p.Evidence {
		p.Evidence[i].Role = strings.TrimSpace(p.Evidence[i].Role)
	}
	if err := validateEvidence(p.Evidence); err != nil {
		return Finding{}, err
	}
	current, err := s.repo.GetFinding(ctx, p.FindingID)
	if err != nil {
		return Finding{}, err
	}
	if current.Version != p.ExpectedVersion {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	return s.repo.ReviseFinding(ctx, p)
}

// ReviewFinding is the only API that changes a finding's status. It records the
// decision, status snapshot, and aggregate version change atomically.
func (s *Service) ReviewFinding(ctx context.Context, p ReviewFindingParams) (Finding, error) {
	if p.FindingID == uuid.Nil {
		return Finding{}, fmt.Errorf("finding id is required")
	}
	if p.ExpectedVersion <= 0 {
		return Finding{}, fmt.Errorf("expected finding version must be positive")
	}
	p.Reviewer = strings.TrimSpace(p.Reviewer)
	if p.Reviewer == "" {
		return Finding{}, fmt.Errorf("finding reviewer must not be empty")
	}
	if strings.TrimSpace(p.Reason) == "" {
		return Finding{}, fmt.Errorf("finding review reason must not be empty")
	}
	current, err := s.repo.GetFinding(ctx, p.FindingID)
	if err != nil {
		return Finding{}, err
	}
	if current.Version != p.ExpectedVersion {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	if !canTransition(current.Status, p.Status) {
		return Finding{}, &ErrIllegalTransition{From: current.Status, To: p.Status}
	}
	return s.repo.ReviewFinding(ctx, p)
}

// TransitionStatus remains as a compatibility wrapper for ReviewFinding.
func (s *Service) TransitionStatus(ctx context.Context, id uuid.UUID, version int, to FindingStatus, reviewer, reason string) (Finding, error) {
	return s.ReviewFinding(ctx, ReviewFindingParams{
		FindingID: id, ExpectedVersion: version, Status: to, Reviewer: reviewer, Reason: reason,
	})
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
	p.ProducedBy = strings.TrimSpace(p.ProducedBy)
	if p.ProducedBy == "" {
		return FindingVerdict{}, fmt.Errorf("verdict producer must not be empty")
	}
	if p.RevisionNo <= 0 {
		return FindingVerdict{}, fmt.Errorf("verified finding revision is required")
	}
	switch p.Verdict {
	case VerdictConfirmed, VerdictRefuted, VerdictInconclusive:
	default:
		return FindingVerdict{}, fmt.Errorf("invalid verdict %q", p.Verdict)
	}
	return s.repo.InsertVerdict(ctx, p)
}

// LinkEvidence is retained only to make the removed unversioned mutation clear
// to old callers. Use ReviseFinding with the complete evidence set instead.
func (s *Service) LinkEvidence(ctx context.Context, findingID, evidenceID uuid.UUID, role string) error {
	return fmt.Errorf("LinkEvidence is unsupported; use ReviseFinding with expected version and full evidence set")
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

// ListFindingsByRun returns the current finding projections for a run. It does
// not expose or modify immutable revisions.
func (s *Service) ListFindingsByRun(ctx context.Context, runID uuid.UUID) ([]Finding, error) {
	return s.repo.ListFindingsByRun(ctx, runID)
}

// GetCurrentRevision returns the immutable revision currently representing a finding.
func (s *Service) GetCurrentRevision(ctx context.Context, findingID uuid.UUID) (FindingRevision, error) {
	return s.repo.GetCurrentRevision(ctx, findingID)
}

// GetRevision returns one immutable finding revision and its evidence snapshot.
func (s *Service) GetRevision(ctx context.Context, findingID uuid.UUID, revisionNo int) (FindingRevision, error) {
	return s.repo.GetRevision(ctx, findingID, revisionNo)
}

// ListRevisions returns newest-first immutable finding revisions.
func (s *Service) ListRevisions(ctx context.Context, findingID uuid.UUID) ([]FindingRevision, error) {
	return s.repo.ListRevisions(ctx, findingID)
}

// GetReportInput returns the current immutable revision and only verdicts that
// verify that revision. A report renderer copies this value into its own
// immutable snapshot and never reads the live evidence projection.
func (s *Service) GetReportInput(ctx context.Context, findingID uuid.UUID) (ReportInput, error) {
	finding, err := s.repo.GetFinding(ctx, findingID)
	if err != nil {
		return ReportInput{}, err
	}
	revision, err := s.repo.GetCurrentRevision(ctx, findingID)
	if err != nil {
		return ReportInput{}, err
	}
	verdicts, err := s.repo.ListVerdicts(ctx, findingID)
	if err != nil {
		return ReportInput{}, err
	}
	currentVerdicts := make([]FindingVerdict, 0, len(verdicts))
	for _, verdict := range verdicts {
		if verdict.RevisionNo != nil && *verdict.RevisionNo == revision.RevisionNo {
			currentVerdicts = append(currentVerdicts, verdict)
		}
	}
	return ReportInput{Finding: finding, Revision: revision, Verdicts: currentVerdicts}, nil
}

func validateContent(title *string, severity Severity, confidence Confidence) error {
	*title = strings.TrimSpace(*title)
	if *title == "" {
		return fmt.Errorf("finding title must not be empty")
	}
	switch severity {
	case SeverityNone, SeverityLow, SeverityMedium, SeverityHigh, SeverityCritical:
	default:
		return fmt.Errorf("invalid severity %q", severity)
	}
	switch confidence {
	case ConfidenceLow, ConfidenceMedium, ConfidenceHigh:
	default:
		return fmt.Errorf("invalid confidence %q", confidence)
	}
	return nil
}

func validateRevisionMetadata(reason, actor string) error {
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("finding revision reason must not be empty")
	}
	if strings.TrimSpace(actor) == "" {
		return fmt.Errorf("finding revision actor must not be empty")
	}
	return nil
}

func validateEvidence(evidence []EvidenceRef) error {
	seen := make(map[uuid.UUID]struct{}, len(evidence))
	for _, item := range evidence {
		if item.EvidenceID == uuid.Nil {
			return fmt.Errorf("finding evidence id is required")
		}
		if _, exists := seen[item.EvidenceID]; exists {
			return fmt.Errorf("finding evidence %s is duplicated", item.EvidenceID)
		}
		seen[item.EvidenceID] = struct{}{}
		switch strings.TrimSpace(item.Role) {
		case "supporting", "refuting", "context":
		default:
			return fmt.Errorf("invalid evidence role %q", item.Role)
		}
	}
	return nil
}
