package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// ErrModelUnavailable reports that the agent loop was asked to run without a
// wired model (for example, no API key configured).
var ErrModelUnavailable = errors.New("agent loop disabled: no model configured")

// ToolExecutor dispatches a capability through execution. Implemented by the
// composition root as a thin adapter over execution.InvokeCapability; the agent
// never runs a tool itself.
type ToolExecutor interface {
	InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error)
}

// RunState reads run/task/agent state and requests lifecycle transitions. The
// agent asks engine/runs to transition; it never writes status itself.
type RunState interface {
	GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error)
	GetTask(ctx context.Context, id uuid.UUID) (runs.Task, error)
	GetAgent(ctx context.Context, id uuid.UUID) (runs.AgentInstance, error)
	TransitionAgent(ctx context.Context, id uuid.UUID, fromVersion int, to runs.AgentStatus) (runs.AgentInstance, error)
}

// GrantChecker reports whether a subject holds an active grant for a capability
// within a scope. Implemented by platform/governance. A snapshot records the
// answer at a point in time but never replaces the dispatch-time check.
type GrantChecker interface {
	CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error)
}

// CapabilityResolver reports whether a capability has a runnable implementation.
// Implemented by tools/registry.
type CapabilityResolver interface {
	Available(id string) bool
}

// Config bounds one agent attempt.
type Config struct {
	MaxSteps       int
	DefaultTimeout time.Duration
	Model          string // default model id when the profile does not set one
}

func (c Config) maxSteps() int {
	if c.MaxSteps <= 0 {
		return 8
	}
	return c.MaxSteps
}

func (c Config) timeout() time.Duration {
	if c.DefaultTimeout <= 0 {
		return 2 * time.Minute
	}
	return c.DefaultTimeout
}

// RunParams identifies the agent to run and the scope it operates under. Scope
// and actor come from the caller (runs does not store the scope); execution
// re-checks both at dispatch.
type RunParams struct {
	AgentID uuid.UUID
	ScopeID uuid.UUID
	Actor   string
	Task    string // optional instruction; defaults to the agent's task name
}

// FindingDraft is a candidate finding produced by an agent. The agent does not
// persist it: findings is the only owner of finding state, so the composition
// root creates the draft through the findings service.
type FindingDraft struct {
	Title       string
	Description string
	Severity    string
	Confidence  string
}

// ToolCall records one capability the agent requested, including its arguments
// so a caller can ground verification in the same check. The agent does not
// persist these; the invocation itself is owned by execution.
type ToolCall struct {
	Capability   string
	Args         json.RawMessage
	InvocationID uuid.UUID
	Execution    string
	RawRef       string
}

// AttemptResult is the outcome of one agent attempt, including the evidence
// produced by successful tool calls so a caller can link it to a finding and
// verify it.
type AttemptResult struct {
	Attempt     Attempt
	Summary     string
	Draft       *FindingDraft
	EvidenceIDs []uuid.UUID
	ToolCalls   []ToolCall
	Steps       int
}

// action is the structured instruction the model returns. Two forms are
// supported: request a tool, or finish with a summary (and optional finding
// draft). JSON is used instead of provider function-calling so the contract is
// stable across adapters.
type action struct {
	Action       string          `json:"action"`
	Capability   string          `json:"capability"`
	Args         json.RawMessage `json:"args"`
	Summary      string          `json:"summary"`
	FindingDraft *findingDraft   `json:"finding_draft"`
}

type findingDraft struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	Confidence  string `json:"confidence"`
}

// Service owns the agent loop and attempt lifecycle. It resolves the agent's
// content/capability snapshot, drives the model and tool calls, and records the
// conversation. It never decides permission and never writes run/task/agent
// status directly.
type Service struct {
	repo     Repository
	model    llm.Model
	builder  *contextbuild.Builder
	exec     ToolExecutor
	runs     RunState
	grants   GrantChecker
	resolver CapabilityResolver
	cfg      Config
	log      *slog.Logger
}

// NewService wires an agent service. model may be nil, in which case RunAgent
// reports ErrModelUnavailable but the rest of the application still works.
func NewService(repo Repository, model llm.Model, builder *contextbuild.Builder, exec ToolExecutor, rrs RunState, grants GrantChecker, resolver CapabilityResolver, cfg Config, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{repo: repo, model: model, builder: builder, exec: exec, runs: rrs, grants: grants, resolver: resolver, cfg: cfg, log: log}
}

// Get returns an attempt by id.
func (s *Service) GetAttempt(ctx context.Context, id uuid.UUID) (Attempt, error) {
	return s.repo.GetAttempt(ctx, id)
}

// ListAttempts returns an agent's attempts, newest first.
func (s *Service) ListAttempts(ctx context.Context, agentID uuid.UUID) ([]Attempt, error) {
	return s.repo.ListAttemptsByAgent(ctx, agentID)
}

// ListMessages returns an attempt's conversation, ordered by sequence.
func (s *Service) ListMessages(ctx context.Context, attemptID uuid.UUID) ([]Message, error) {
	return s.repo.ListMessages(ctx, attemptID)
}

// GetSnapshot returns the most recent snapshot for an agent.
func (s *Service) GetSnapshot(ctx context.Context, agentID uuid.UUID) (Snapshot, error) {
	return s.repo.GetSnapshotByAgent(ctx, agentID)
}

// CancelRunningAttempts marks all running attempts of an agent as cancelled and
// returns how many it changed. It only touches agent_attempts, owned by this
// module; transitioning the agent instance itself is engine/runs's job.
func (s *Service) CancelRunningAttempts(ctx context.Context, agentID uuid.UUID) (int, error) {
	attempts, err := s.repo.ListAttemptsByAgent(ctx, agentID)
	if err != nil {
		return 0, err
	}
	cancelled := 0
	for _, a := range attempts {
		if a.Status != AttemptRunning {
			continue
		}
		if _, err := s.repo.FinishAttempt(ctx, FinishAttemptParams{
			ID:         a.ID,
			Status:     AttemptCancelled,
			FinishedAt: time.Now().UTC(),
		}); err != nil {
			var terminal *ErrAttemptNotRunning
			if errors.As(err, &terminal) {
				continue
			}
			return cancelled, err
		}
		cancelled++
	}
	return cancelled, nil
}

// RunAgent runs one attempt of an agent: resolve content, record a snapshot,
// transition the agent to running, loop model/tool until a final answer or the
// step budget, then record the attempt outcome and request the agent transition.
func (s *Service) RunAgent(ctx context.Context, p RunParams) (AttemptResult, error) {
	p.Actor = strings.TrimSpace(p.Actor)
	if p.AgentID == uuid.Nil || p.ScopeID == uuid.Nil {
		return AttemptResult{}, fmt.Errorf("agent and scope are required")
	}
	if p.Actor == "" {
		return AttemptResult{}, fmt.Errorf("actor is required")
	}
	if s.model == nil {
		return AttemptResult{}, ErrModelUnavailable
	}

	agent, err := s.runs.GetAgent(ctx, p.AgentID)
	if err != nil {
		return AttemptResult{}, err
	}
	run, err := s.runs.GetRun(ctx, agent.RunID)
	if err != nil {
		return AttemptResult{}, err
	}
	switch run.Status {
	case runs.RunCancelled, runs.RunCompleted, runs.RunBudgetExhausted:
		return AttemptResult{}, fmt.Errorf("run %s is in state %s", run.ID, run.Status)
	}

	task := strings.TrimSpace(p.Task)
	if task == "" && agent.TaskID != nil {
		if t, err := s.runs.GetTask(ctx, *agent.TaskID); err == nil {
			task = t.Name
		}
	}

	resolved, err := s.builder.Resolve(ctx, agent.Profile)
	if err != nil {
		return AttemptResult{}, err
	}
	if _, err := s.resolveSnapshot(ctx, agent, resolved, p.ScopeID, p.Actor); err != nil {
		return AttemptResult{}, fmt.Errorf("resolve snapshot: %w", err)
	}

	// Move the agent to running through engine/runs before doing work.
	if agent.Status != runs.AgentRunning {
		agent, err = s.runs.TransitionAgent(ctx, agent.ID, agent.Version, runs.AgentRunning)
		if err != nil {
			return AttemptResult{}, fmt.Errorf("transition agent to running: %w", err)
		}
	}

	attempt, err := s.repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: agent.ID})
	if err != nil {
		return AttemptResult{}, err
	}

	dctx, cancel := context.WithTimeout(ctx, s.cfg.timeout())
	defer cancel()

	result, status := s.loop(dctx, agent, attempt, p.ScopeID, p.Actor, resolved, task)

	finished, err := s.repo.FinishAttempt(ctx, FinishAttemptParams{ID: attempt.ID, Status: status, FinishedAt: time.Now().UTC()})
	if err != nil {
		var terminal *ErrAttemptNotRunning
		if errors.As(err, &terminal) {
			finished, err = s.repo.GetAttempt(ctx, attempt.ID)
			if err != nil {
				return AttemptResult{}, err
			}
			result.Attempt = finished
			return result, nil
		}
		return AttemptResult{}, err
	}
	result.Attempt = finished

	// Map the attempt outcome onto the agent lifecycle (runs owns the states).
	agentStatus := runs.AgentCompleted
	switch status {
	case AttemptFailed, AttemptTimedOut:
		agentStatus = runs.AgentFailed
	case AttemptCancelled:
		agentStatus = runs.AgentCancelled
	}
	if _, err := s.runs.TransitionAgent(ctx, agent.ID, agent.Version, agentStatus); err != nil {
		s.log.Warn("agent attempt finished but lifecycle transition failed", "agent", agent.ID, "error", err)
	}
	return result, nil
}
