package verifier

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

// Executor dispatches a capability through execution. Implemented by the
// composition root as a thin adapter over execution.InvokeCapability; the
// verifier never runs a process or calls a tool directly.
type Executor interface {
	InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error)
}

// FindingReader reads the immutable revision under verification. Implemented
// by workspace/findings.
type FindingReader interface {
	GetCurrentRevision(ctx context.Context, findingID uuid.UUID) (findings.FindingRevision, error)
}

// VerdictWriter records a verdict. Implemented by workspace/findings, which
// remains the only owner of finding status.
type VerdictWriter interface {
	RecordVerdict(ctx context.Context, p findings.InsertVerdictParams) (findings.FindingVerdict, error)
}

// Service verifies findings by re-running checks through execution.
type Service struct {
	exec     Executor
	reader   FindingReader
	verdict  VerdictWriter
	producer string
}

// NewService wires a verifier. producer is recorded as the verdict author.
func NewService(exec Executor, reader FindingReader, verdict VerdictWriter, producer string) *Service {
	if strings.TrimSpace(producer) == "" {
		producer = "verifier"
	}
	return &Service{exec: exec, reader: reader, verdict: verdict, producer: producer}
}

// Verify reads the finding, runs each check through execution, aggregates a
// verdict, and records it. It never changes the finding status.
func (s *Service) Verify(ctx context.Context, p VerifyParams) (Result, error) {
	if p.FindingID == uuid.Nil {
		return Result{}, fmt.Errorf("finding id is required")
	}
	if p.RunID == uuid.Nil || p.ScopeID == uuid.Nil {
		return Result{}, fmt.Errorf("run and scope are required")
	}
	if strings.TrimSpace(p.Actor) == "" {
		return Result{}, fmt.Errorf("actor is required")
	}
	revision, err := s.reader.GetCurrentRevision(ctx, p.FindingID)
	if err != nil {
		return Result{}, err
	}

	if len(p.Checks) == 0 {
		return s.record(ctx, p.FindingID, revision.RevisionNo, findings.VerdictInconclusive, "no verification criteria apply to this finding", nil)
	}

	confirmed, refuted := 0, 0
	evidence := make([]uuid.UUID, 0)
	reasons := make([]string, 0, len(p.Checks))
	for i, check := range p.Checks {
		outcome, reason, rawRef, err := s.runCheck(ctx, p, revision.RevisionNo, i, check)
		if err != nil {
			return Result{}, err
		}
		if rawRef != nil {
			evidence = append(evidence, *rawRef)
		}
		reasons = append(reasons, reason)
		switch outcome {
		case findings.VerdictConfirmed:
			confirmed++
		case findings.VerdictRefuted:
			refuted++
		}
	}

	verdict := findings.VerdictInconclusive
	switch {
	case refuted > 0:
		verdict = findings.VerdictRefuted
	case confirmed > 0:
		verdict = findings.VerdictConfirmed
	}
	return s.record(ctx, p.FindingID, revision.RevisionNo, verdict, strings.Join(reasons, "; "), evidence)
}

// runCheck re-runs one capability and classifies the result. A denied re-run is
// inconclusive (permission changed), and a failed/timed-out re-run is
// inconclusive unless the criterion explicitly refutes on that outcome.
func (s *Service) runCheck(ctx context.Context, p VerifyParams, revisionNo, index int, check Check) (findings.Verdict, string, *uuid.UUID, error) {
	if strings.TrimSpace(check.Capability) == "" {
		return findings.VerdictInconclusive, "check has no capability", nil, nil
	}
	confirmOn := check.ConfirmOn
	if confirmOn == "" {
		confirmOn = output.ExecutionSuccess
	}
	_, res, err := s.exec.InvokeCapability(ctx, invocation.InvokeParams{
		RunID:          p.RunID,
		ScopeID:        p.ScopeID,
		Actor:          p.Actor,
		Capability:     check.Capability,
		Args:           check.Args,
		IdempotencyKey: fmt.Sprintf("verify:%s:%d:%d", p.FindingID, revisionNo, index),
	})
	if err != nil {
		return "", "", nil, fmt.Errorf("verify check %d: %w", index, err)
	}
	if res == nil {
		return findings.VerdictInconclusive, fmt.Sprintf("%s: no result", check.Capability), nil, nil
	}
	var rawRef *uuid.UUID
	if res.RawRef != "" {
		if id, err := uuid.Parse(res.RawRef); err == nil {
			rawRef = &id
		}
	}
	label := check.Capability
	if check.Reason != "" {
		label += " (" + check.Reason + ")"
	}

	switch {
	case res.Execution == output.ExecutionDenied:
		return findings.VerdictInconclusive, label + ": denied", rawRef, nil
	case check.RefuteOn != "" && res.Execution == check.RefuteOn:
		return findings.VerdictRefuted, fmt.Sprintf("%s: refuted on %s", label, res.Execution), rawRef, nil
	case res.Execution == confirmOn:
		return findings.VerdictConfirmed, fmt.Sprintf("%s: confirmed on %s", label, res.Execution), rawRef, nil
	default:
		return findings.VerdictInconclusive, fmt.Sprintf("%s: inconclusive on %s", label, res.Execution), rawRef, nil
	}
}

func (s *Service) record(ctx context.Context, findingID uuid.UUID, revisionNo int, verdict findings.Verdict, reason string, evidence []uuid.UUID) (Result, error) {
	if _, err := s.verdict.RecordVerdict(ctx, findings.InsertVerdictParams{
		FindingID:  findingID,
		RevisionNo: revisionNo,
		Verdict:    verdict,
		Reason:     reason,
		ProducedBy: s.producer,
	}); err != nil {
		return Result{}, fmt.Errorf("record verdict: %w", err)
	}
	return Result{RevisionNo: revisionNo, Verdict: verdict, Reason: reason, EvidenceIDs: evidence}, nil
}
