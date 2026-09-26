package reporting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// InputSnapshotter supplies a complete, JSON-serializable report input for one
// run. Its implementation composes finding revisions and evidence references
// without exposing either module's repository to reporting.
type InputSnapshotter interface {
	SnapshotReportInputs(ctx context.Context, runID uuid.UUID) (json.RawMessage, error)
}

// OutputEvidence validates that a final artifact is available and belongs to
// the report run. It is intentionally narrower than the evidence service.
type OutputEvidence interface {
	ValidateReportOutput(ctx context.Context, runID, artifactID uuid.UUID) error
}

// Service owns request creation and status transitions, but never renders a
// template or owns a queue implementation.
type Service struct {
	repo          Repository
	inputs        InputSnapshotter
	evidence      OutputEvidence
	templates     TemplateResolver
	output        OutputPublisher
	leaseDuration time.Duration
}

// NewService wires reporting to its own repository and narrow cross-module
// contracts. The composition root supplies concrete adapters.
func NewService(repo Repository, inputs InputSnapshotter, evidence OutputEvidence, render ...RenderConfig) *Service {
	svc := &Service{repo: repo, inputs: inputs, evidence: evidence}
	if len(render) > 0 {
		svc.templates = render[0].Templates
		svc.output = render[0].Output
		svc.leaseDuration = render[0].LeaseDuration
	}
	return svc
}

var templateHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Request creates the one report request for a run. A retry with the exact same
// template returns the existing immutable report without recapturing inputs.
func (s *Service) Request(ctx context.Context, p RequestParams) (Report, error) {
	report, _, err := s.request(ctx, p, nil)
	return report, err
}

// RequestAndEnqueue creates the immutable report and enqueues its worker only
// when it was newly created. The caller supplies a transaction-bound enqueue
// function, keeping request, snapshot, and River insert in one short transaction.
func (s *Service) RequestAndEnqueue(ctx context.Context, p RequestParams, enqueue func(context.Context, Report) error) (Report, error) {
	report, _, err := s.request(ctx, p, enqueue)
	return report, err
}

func (s *Service) request(ctx context.Context, p RequestParams, enqueue func(context.Context, Report) error) (Report, bool, error) {
	if err := validateRequest(&p); err != nil {
		return Report{}, false, err
	}
	current, err := s.repo.GetByRun(ctx, p.RunID)
	if err == nil {
		if current.Template != p.Template {
			return Report{}, false, &ErrReportAlreadyRequested{RunID: p.RunID}
		}
		return current, false, nil
	}
	var notFound *ErrReportNotFound
	if !errors.As(err, &notFound) {
		return Report{}, false, err
	}
	if s.inputs == nil {
		return Report{}, false, fmt.Errorf("report input snapshotter is not wired")
	}

	snapshot, err := s.inputs.SnapshotReportInputs(ctx, p.RunID)
	if err != nil {
		return Report{}, false, fmt.Errorf("capture report inputs: %w", err)
	}
	snapshot, err = normalizeSnapshot(snapshot)
	if err != nil {
		return Report{}, false, err
	}
	result, err := s.repo.CreateOrGet(ctx, CreateParams{RunID: p.RunID, Template: p.Template, Snapshot: snapshot})
	if err != nil {
		return Report{}, false, err
	}
	if !result.Created && result.Report.Template != p.Template {
		return Report{}, false, &ErrReportAlreadyRequested{RunID: p.RunID}
	}
	if result.Created && enqueue != nil {
		if err := enqueue(ctx, result.Report); err != nil {
			return Report{}, false, fmt.Errorf("enqueue report render: %w", err)
		}
	}
	return result.Report, result.Created, nil
}

// Get returns a report by its durable id.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Report, error) {
	return s.repo.Get(ctx, id)
}

// Claim acquires a lease for rendering. An expired rendering lease may be taken
// over by a newer worker with the current optimistic version.
func (s *Service) Claim(ctx context.Context, p ClaimParams) (Report, error) {
	if p.ID == uuid.Nil {
		return Report{}, fmt.Errorf("report id is required")
	}
	if p.ExpectedVersion <= 0 {
		return Report{}, fmt.Errorf("expected report version must be positive")
	}
	p.Worker = strings.TrimSpace(p.Worker)
	if p.Worker == "" {
		return Report{}, fmt.Errorf("report worker is required")
	}
	if p.LeaseDuration < time.Microsecond {
		return Report{}, fmt.Errorf("report lease duration must be at least one microsecond")
	}
	return s.repo.Claim(ctx, p)
}

// Complete validates an available evidence artifact then atomically links it
// and marks the report complete. Replayed worker delivery returns the single
// already-linked output rather than overwriting it.
func (s *Service) Complete(ctx context.Context, p CompleteParams) (Report, error) {
	if err := validateCompletion(&p); err != nil {
		return Report{}, err
	}
	current, err := s.repo.Get(ctx, p.ID)
	if err != nil {
		return Report{}, err
	}
	if current.Status == StatusCompleted {
		return current, nil
	}
	if s.evidence == nil {
		return Report{}, fmt.Errorf("report output evidence is not wired")
	}
	if err := s.evidence.ValidateReportOutput(ctx, current.RunID, p.OutputArtifactID); err != nil {
		return Report{}, fmt.Errorf("validate report output: %w", err)
	}
	return s.repo.Complete(ctx, p)
}

// Fail records a rendering failure only while the caller holds the lease.
func (s *Service) Fail(ctx context.Context, p FailParams) (Report, error) {
	if p.ID == uuid.Nil || p.ExpectedVersion <= 0 || strings.TrimSpace(p.Worker) == "" {
		return Report{}, fmt.Errorf("report id, expected version, and worker are required")
	}
	p.Worker = strings.TrimSpace(p.Worker)
	p.Code = strings.TrimSpace(p.Code)
	if p.Code == "" {
		return Report{}, fmt.Errorf("report failure code is required")
	}
	p.Message = strings.TrimSpace(p.Message)
	return s.repo.Fail(ctx, p)
}

// Cancel transitions queued or rendering work to cancelled at the expected version.
func (s *Service) Cancel(ctx context.Context, p CancelParams) (Report, error) {
	if p.ID == uuid.Nil || p.ExpectedVersion <= 0 {
		return Report{}, fmt.Errorf("report id and expected version are required")
	}
	return s.repo.Cancel(ctx, p)
}

func validateRequest(p *RequestParams) error {
	if p.RunID == uuid.Nil {
		return fmt.Errorf("report run id is required")
	}
	p.Template.ID = strings.TrimSpace(p.Template.ID)
	p.Template.Version = strings.TrimSpace(p.Template.Version)
	p.Template.Hash = strings.ToLower(strings.TrimSpace(p.Template.Hash))
	if p.Template.ID == "" || p.Template.Version == "" {
		return fmt.Errorf("report template id and version are required")
	}
	if !templateHash.MatchString(p.Template.Hash) {
		return fmt.Errorf("report template hash must be a lowercase SHA-256 hex string")
	}
	return nil
}

func normalizeSnapshot(snapshot json.RawMessage) (json.RawMessage, error) {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(snapshot, &document); err != nil || document == nil {
		return nil, fmt.Errorf("report input snapshot must be a JSON object")
	}
	normalized, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("encode report input snapshot: %w", err)
	}
	return normalized, nil
}

func validateCompletion(p *CompleteParams) error {
	if p.ID == uuid.Nil || p.OutputArtifactID == uuid.Nil || p.ExpectedVersion <= 0 {
		return fmt.Errorf("report id, output artifact id, and expected version are required")
	}
	p.Worker = strings.TrimSpace(p.Worker)
	if p.Worker == "" {
		return fmt.Errorf("report worker is required")
	}
	return nil
}
