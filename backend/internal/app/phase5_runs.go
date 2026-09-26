package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
	"github.com/Akapi895/raptix/backend/internal/workspace/verifier"
)

// RunAgentParams is the caller request to run an agent attempt. When AgentID is
// zero an agent instance is created from Profile; otherwise the existing agent
// is used. The scope is derived from the persisted run before dispatch.
type RunAgentParams struct {
	RunID      uuid.UUID
	TaskID     *uuid.UUID
	AgentID    uuid.UUID
	Profile    string
	Actor      string
	Task       string
	RequestKey string
}

// RunAgentResult is the outcome of the Phase 5 use case: the agent attempt plus
// the finding draft and verdict it produced, if any.
type RunAgentResult struct {
	AgentID   uuid.UUID
	Attempt   agents.Attempt
	Summary   string
	FindingID *uuid.UUID
	Verdict   *findings.Verdict
}

// RunAgent runs one agent attempt and, when the agent produces a finding draft,
// turns it into a finding draft with linked evidence and verifies it. The agent
// loop dispatches every capability through execution; the verifier re-checks
// through the same path. Findings remains the only owner of finding status.
func (s *Services) RunAgent(ctx context.Context, p RunAgentParams) (RunAgentResult, error) {
	p.Actor = strings.TrimSpace(p.Actor)
	p.Task = strings.TrimSpace(p.Task)
	if p.Actor == "" {
		return RunAgentResult{}, fmt.Errorf("actor is required")
	}

	agent, err := s.resolveAgent(ctx, p)
	if err != nil {
		return RunAgentResult{}, err
	}
	run, err := s.Runs.GetRun(ctx, agent.RunID)
	if err != nil {
		return RunAgentResult{}, err
	}
	if p.RunID != uuid.Nil && p.RunID != run.ID {
		return RunAgentResult{}, fmt.Errorf("agent %s does not belong to run %s", agent.ID, p.RunID)
	}

	attempt, err := s.Agents.RunAgent(ctx, agents.RunParams{
		AgentID: agent.ID, Actor: p.Actor, Task: p.Task,
		RequestKey:         p.RequestKey,
		RequestFingerprint: requestFingerprint(agent.ID, p.Actor, p.Task),
	})
	out := RunAgentResult{AgentID: agent.ID, Attempt: attempt.Attempt, Summary: attempt.Summary}
	if err != nil {
		return out, err
	}

	if attempt.Draft == nil {
		return out, nil
	}

	title := strings.TrimSpace(attempt.Draft.Title)
	if title == "" {
		title = strings.TrimSpace(attempt.Summary)
	}
	if title == "" {
		title = "agent finding draft"
	}
	evidence := make([]findings.EvidenceRef, 0, len(attempt.EvidenceIDs))
	for _, evidenceID := range attempt.EvidenceIDs {
		evidence = append(evidence, findings.EvidenceRef{EvidenceID: evidenceID, Role: "supporting"})
	}
	finding, err := s.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID:       agent.RunID,
		Title:       title,
		Description: attempt.Draft.Description,
		Severity:    parseSeverity(attempt.Draft.Severity),
		Confidence:  parseConfidence(attempt.Draft.Confidence),
		Evidence:    evidence,
		Actor:       p.Actor,
	})
	if err != nil {
		return out, fmt.Errorf("create finding draft: %w", err)
	}
	out.FindingID = &finding.ID

	// Verify by re-running the successful tool calls through execution. A
	// failure to re-run is inconclusive, not refuted.
	checks := make([]verifier.Check, 0, len(attempt.ToolCalls))
	for _, call := range attempt.ToolCalls {
		if call.Execution != string(output.ExecutionSuccess) {
			continue
		}
		checks = append(checks, verifier.Check{
			Capability: call.Capability,
			Args:       call.Args,
			ConfirmOn:  output.ExecutionSuccess,
			Reason:     "re-run of the originating check",
		})
	}
	result, err := s.Verifier.Verify(ctx, verifier.VerifyParams{
		FindingID: finding.ID, RunID: agent.RunID, ScopeID: run.ScopeID, Actor: p.Actor, Checks: checks,
	})
	if err != nil {
		return out, fmt.Errorf("verify finding: %w", err)
	}
	out.Verdict = &result.Verdict
	return out, nil
}

// resolveAgent returns the agent to run, creating one from the profile when no
// id is supplied.
func (s *Services) resolveAgent(ctx context.Context, p RunAgentParams) (runs.AgentInstance, error) {
	if p.AgentID != uuid.Nil {
		return s.Runs.GetAgent(ctx, p.AgentID)
	}
	if strings.TrimSpace(p.Profile) == "" {
		return runs.AgentInstance{}, fmt.Errorf("agent id or profile is required")
	}
	if p.RunID == uuid.Nil {
		return runs.AgentInstance{}, fmt.Errorf("run id is required to create an agent")
	}
	return s.Runs.CreateAgent(ctx, p.RunID, p.TaskID, p.Profile)
}

func parseSeverity(s string) findings.Severity {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "none":
		return findings.SeverityNone
	case "low":
		return findings.SeverityLow
	case "high":
		return findings.SeverityHigh
	case "critical":
		return findings.SeverityCritical
	default:
		return findings.SeverityMedium
	}
}

func parseConfidence(s string) findings.Confidence {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "low":
		return findings.ConfidenceLow
	case "high":
		return findings.ConfidenceHigh
	default:
		return findings.ConfidenceMedium
	}
}
