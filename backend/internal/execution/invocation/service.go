package invocation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/tools/registry"
)

// Config carries execution limits for the invocation service.
type Config struct {
	DefaultTimeout       time.Duration
	MaxOutputBytes       int64
	MaxInvocationsPerRun int // 0 = unlimited
}

// GrantChecker reports whether a subject holds an active grant for a capability
// within a scope. Implemented by platform/governance.
type GrantChecker interface {
	CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error)
}

// ScopeReader reports whether a scope may currently authorize action.
// Implemented by platform/projects.
type ScopeReader interface {
	IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error)
}

// RunStateReader reads run lifecycle state. Implemented by engine/runs.
type RunStateReader interface {
	GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error)
}

// AuditRecorder records a business decision. Implemented by platform/audit.
type AuditRecorder interface {
	Record(ctx context.Context, rec audit.Record) (audit.AuditRecord, error)
}

// Service dispatches capability invocations with governance enforcement. It
// records the invocation durably before dispatching, then applies the returned
// result. Evidence bytes are produced by the capability implementation itself;
// only its artifact refs are persisted here.
type Service struct {
	repo     Repository
	grants   GrantChecker
	scopes   ScopeReader
	runs     RunStateReader
	audit    AuditRecorder
	resolver *registry.Registry
	cfg      Config
	log      *slog.Logger
}

// NewService wires an invocation service.
func NewService(repo Repository, cfg Config, grants GrantChecker, scopes ScopeReader, rrs RunStateReader, ar AuditRecorder, resolver *registry.Registry, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{repo: repo, cfg: cfg, grants: grants, scopes: scopes, runs: rrs, audit: ar, resolver: resolver, log: log}
}

// InvokeParams is a validated dispatch request.
type InvokeParams struct {
	RunID          uuid.UUID
	TaskID         *uuid.UUID
	ScopeID        uuid.UUID
	Actor          string
	Capability     string
	Version        string // optional; empty resolves the latest
	Args           json.RawMessage
	IdempotencyKey string // optional; empty is auto-generated
}

// Invoke runs a capability through execution. A denied check returns an
// invocation in StatusDenied and a denied output.Result with a nil error: denial
// is an expected outcome, not a failure of the execution path.
func (s *Service) Invoke(ctx context.Context, p InvokeParams) (Invocation, *output.Result, error) {
	p.Actor = strings.TrimSpace(p.Actor)
	p.Capability = strings.TrimSpace(p.Capability)
	// deny returns a transient StatusDenied invocation (not persisted) together
	// with a denied result; denial is an expected outcome, so the error is nil.
	deny := func(reason string) (Invocation, *output.Result, error) {
		s.recordDecision(ctx, audit.OutcomeDenied, p, reason)
		return Invocation{Status: StatusDenied}, output.Denied(reason), nil
	}

	if p.RunID == uuid.Nil || p.ScopeID == uuid.Nil {
		return Invocation{Status: StatusDenied}, output.Denied("run and scope are required"), nil
	}
	if p.Actor == "" || p.Capability == "" {
		return Invocation{Status: StatusDenied}, output.Denied("actor and capability are required"), nil
	}
	if p.IdempotencyKey == "" {
		p.IdempotencyKey = uuid.NewString()
	}

	// Idempotency: a repeated (run, key) returns the prior invocation unchanged.
	// Only a genuine "not found" proceeds; any other repository error surfaces
	// rather than silently re-dispatching under a transient database failure.
	if existing, err := s.repo.GetByRunAndIdempotencyKey(ctx, p.RunID, p.IdempotencyKey); err == nil {
		return idempotentOutcome(existing)
	} else {
		var nf *ErrInvocationNotFound
		if !errors.As(err, &nf) {
			return Invocation{}, nil, fmt.Errorf("check idempotency: %w", err)
		}
	}

	// Run must still accept work.
	run, err := s.runs.GetRun(ctx, p.RunID)
	if err != nil {
		return Invocation{}, output.Denied(fmt.Sprintf("run %s is not available", p.RunID)), nil
	}
	if run.Status == runs.RunCancelled || run.Status == runs.RunCompleted || run.Status == runs.RunBudgetExhausted {
		return deny(fmt.Sprintf("run %s is in state %s", p.RunID, run.Status))
	}

	// Scope must still be valid.
	active, err := s.scopes.IsScopeActive(ctx, p.ScopeID)
	if err != nil {
		return deny("could not validate scope")
	}
	if !active {
		return deny("scope is not active")
	}

	// Governance grant at dispatch time.
	granted, err := s.grants.CheckActiveGrant(ctx, p.Actor, p.ScopeID, p.Capability)
	if err != nil {
		return deny("could not evaluate grant")
	}
	if !granted {
		return deny(fmt.Sprintf("%s has no active %s grant in scope %s", p.Actor, p.Capability, p.ScopeID))
	}

	// Capability must have a bound implementation.
	impl, _, err := s.resolver.GetVersion(p.Capability, p.Version)
	if err != nil {
		return deny(fmt.Sprintf("capability %s is not available", p.Capability))
	}

	// Budget is enforced before a dispatch row is written (denied attempts are
	// never counted).
	if s.cfg.MaxInvocationsPerRun > 0 {
		n, err := s.repo.CountByRun(ctx, p.RunID)
		if err != nil {
			return deny("could not evaluate run budget")
		}
		if n >= int64(s.cfg.MaxInvocationsPerRun) {
			return deny("run invocation budget exhausted")
		}
	}

	// Record the pending invocation, then audit the allowed decision.
	created, err := s.repo.CreateInvocation(ctx, CreateParams{
		RunID: p.RunID, TaskID: p.TaskID, ScopeID: p.ScopeID, Actor: p.Actor,
		Capability: p.Capability, CapabilityVersion: p.Version,
		Request: p.Args, IdempotencyKey: p.IdempotencyKey,
	})
	if err != nil {
		var conflict *ErrIdempotencyConflict
		if errors.As(err, &conflict) {
			existing, lookupErr := s.repo.GetByRunAndIdempotencyKey(ctx, p.RunID, p.IdempotencyKey)
			if lookupErr != nil {
				return Invocation{}, nil, fmt.Errorf("read concurrent idempotency result: %w", lookupErr)
			}
			return idempotentOutcome(existing)
		}
		var inactive *ErrRunNotAcceptingWork
		if errors.As(err, &inactive) {
			return deny(fmt.Sprintf("run %s is in a terminal state", p.RunID))
		}
		return Invocation{}, nil, fmt.Errorf("record invocation: %w", err)
	}
	s.recordDecision(ctx, audit.OutcomeAllowed, p, created.ID.String())

	// Mark the invocation running with a started_at before dispatch. This
	// separates "created but not yet dispatched" (pending) from "in flight"
	// (running), which is what stale detection and cancellation rely on. If the
	// process dies here or during dispatch, reconcile finds the non-terminal row.
	running, err := s.repo.StartInvocation(ctx, created.ID, created.Version)
	if err != nil {
		return Invocation{}, nil, fmt.Errorf("start invocation: %w", err)
	}

	dctx, cancel := context.WithTimeout(ctx, s.timeout())
	defer cancel()
	start := time.Now()
	res, invokeErr := impl.Invoke(dctx, p.Args)
	elapsed := time.Since(start).Milliseconds()

	if invokeErr != nil {
		res = output.Error("", invokeErr)
	}
	if res == nil {
		res = output.Error("", fmt.Errorf("capability returned nil result"))
	}
	if res.DurationMs == 0 {
		res.DurationMs = elapsed
	}
	if err := res.Validate(); err != nil {
		s.log.Warn("capability produced invalid result", "capability", p.Capability, "error", err)
		res = output.Error("", fmt.Errorf("invalid capability result: %w", err))
	}

	now := time.Now().UTC()
	updated, err := s.repo.UpdateResult(ctx, ResultUpdate{
		ID:                   running.ID,
		Version:              running.Version,
		Status:               mapOutcome(res.Execution),
		RawArtifactID:        parseRef(res.RawRef),
		StructuredArtifactID: parseRef(res.StructuredRef),
		ResultExecution:      string(res.Execution),
		ResultParse:          string(res.Parse),
		ExitCode:             res.ExitCode,
		ErrorCode:            resultErrorCode(res),
		ErrorMessage:         resultErrorMessage(res),
		FinishedAt:           now,
	})
	if err != nil {
		return Invocation{}, res, fmt.Errorf("record invocation result: %w", err)
	}
	return updated, res, nil
}

func idempotentOutcome(existing Invocation) (Invocation, *output.Result, error) {
	switch existing.Status {
	case StatusPending, StatusDispatched, StatusRunning, StatusUnknown:
		// The prior attempt may not have completed. Do not treat it as a result
		// and never issue another dispatch for the same idempotency key.
		return Invocation{}, nil, &ErrOutcomeUnknown{ID: existing.ID, Status: existing.Status}
	default:
		return existing, nil, nil
	}
}

// Get returns an invocation by id for read-back and tests.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Invocation, error) {
	return s.repo.GetInvocation(ctx, id)
}

// ListByRun returns a run's invocations, newest first.
func (s *Service) ListByRun(ctx context.Context, runID uuid.UUID) ([]Invocation, error) {
	return s.repo.ListByRun(ctx, runID)
}

// timeout returns the effective dispatch timeout.
func (s *Service) timeout() time.Duration {
	if s.cfg.DefaultTimeout <= 0 {
		return 30 * time.Second
	}
	return s.cfg.DefaultTimeout
}

// mapOutcome maps an execution status to an invocation status.
func mapOutcome(exec output.ExecutionStatus) Status {
	switch exec {
	case output.ExecutionSuccess:
		return StatusSucceeded
	case output.ExecutionFailed:
		return StatusFailed
	case output.ExecutionTimedOut:
		return StatusTimedOut
	case output.ExecutionCancelled:
		return StatusCancelled
	case output.ExecutionDenied:
		return StatusDenied
	default:
		return StatusFailed
	}
}

// parseRef converts an artifact id string into a uuid pointer, or nil when blank.
func parseRef(ref string) *uuid.UUID {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	id, err := uuid.Parse(ref)
	if err != nil {
		return nil
	}
	return &id
}

func resultErrorCode(res *output.Result) string {
	if res.Error != nil {
		return res.Error.Code
	}
	return ""
}

func resultErrorMessage(res *output.Result) string {
	if res.Error != nil {
		return res.Error.Message
	}
	return ""
}

func (s *Service) recordDecision(ctx context.Context, outcome audit.Outcome, p InvokeParams, resource string) {
	_, _ = s.audit.Record(ctx, audit.Record{
		Actor:       p.Actor,
		Action:      "tool.invoke." + p.Capability,
		Resource:    resource,
		Outcome:     outcome,
		Reason:      "capability dispatch",
		Correlation: p.RunID.String(),
	})
}
