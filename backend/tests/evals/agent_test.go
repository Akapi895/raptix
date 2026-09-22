package evals

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

type agentCase struct {
	Name       string `yaml:"name"`
	Capability string `yaml:"capability"`
	Input      struct {
		Profile string   `yaml:"profile"`
		Task    string   `yaml:"task"`
		Script  []string `yaml:"script"`
	} `yaml:"input"`
	Expect struct {
		AttemptStatus   string `yaml:"attempt_status"`
		ToolCalls       int    `yaml:"tool_calls"`
		HasFindingDraft bool   `yaml:"has_finding_draft"`
	} `yaml:"expect"`
}

type agentBaseline struct {
	Name            string `json:"name"`
	Capability      string `json:"capability"`
	AttemptStatus   string `json:"attempt_status"`
	ToolCalls       int    `json:"tool_calls"`
	HasFindingDraft bool   `json:"has_finding_draft"`
}

// TestAgentCaseMatchesBaseline runs the scripted agent case with fake model,
// executor and state so the agent loop is measured deterministically without a
// database or an API key.
func TestAgentCaseMatchesBaseline(t *testing.T) {
	root := repoRoot(t)
	raw, err := os.ReadFile(filepath.Join(root, "evals", "cases", "agent_http_probe.yaml"))
	if err != nil {
		t.Fatalf("read case: %v", err)
	}
	var c agentCase
	if err := yaml.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse case: %v", err)
	}
	baseRaw, err := os.ReadFile(filepath.Join(root, "evals", "baselines", c.Name+".json"))
	if err != nil {
		t.Fatalf("read baseline: %v", err)
	}
	var want agentBaseline
	if err := json.Unmarshal(baseRaw, &want); err != nil {
		t.Fatalf("parse baseline: %v", err)
	}

	lab := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("lab-ok"))
	}))
	defer lab.Close()

	script := make([]string, len(c.Input.Script))
	for i, s := range c.Input.Script {
		script[i] = strings.ReplaceAll(s, labPlaceholder, lab.URL)
	}

	model := &scriptedModel{script: script}
	exec := &recordingExec{}
	runState := &staticRuns{
		agent: runs.AgentInstance{ID: uuid.New(), RunID: uuid.New(), Profile: c.Input.Profile, Status: runs.AgentPaused, Version: 1},
	}
	runState.run = runs.Run{ID: runState.agent.RunID, Status: runs.RunRunning}
	builder := contextbuild.NewBuilder(&staticSource{profile: reconProfile(c.Input.Profile)}, contextbuild.Budget{MaxTokens: 4000})
	svc := agents.NewService(newAgentRepo(), model, builder, exec, runState, &allowGrants{}, &staticResolver{available: map[string]bool{"http_probe": true}},
		agents.Config{MaxSteps: 5, DefaultTimeout: time.Second, Model: "eval-model"}, nil)

	res, err := svc.RunAgent(context.Background(), agents.RunParams{
		AgentID: runState.agent.ID, ScopeID: uuid.New(), Actor: "eval", Task: c.Input.Task,
	})
	if err != nil {
		t.Fatalf("RunAgent: %v", err)
	}

	got := agentBaseline{
		Name: c.Name, Capability: c.Capability,
		AttemptStatus: string(res.Attempt.Status), ToolCalls: len(exec.calls), HasFindingDraft: res.Draft != nil,
	}
	if got.AttemptStatus != want.AttemptStatus {
		t.Errorf("attempt_status = %s, want %s", got.AttemptStatus, want.AttemptStatus)
	}
	if got.ToolCalls != want.ToolCalls {
		t.Errorf("tool_calls = %d, want %d", got.ToolCalls, want.ToolCalls)
	}
	if got.HasFindingDraft != want.HasFindingDraft {
		t.Errorf("has_finding_draft = %v, want %v", got.HasFindingDraft, want.HasFindingDraft)
	}
	if c.Expect.AttemptStatus != want.AttemptStatus || c.Expect.ToolCalls != want.ToolCalls || c.Expect.HasFindingDraft != want.HasFindingDraft {
		t.Errorf("case expectation %+v disagrees with baseline %+v", c.Expect, want)
	}
}

func reconProfile(name string) *content.Profile {
	p := &content.Profile{Model: "eval-model"}
	p.Name = name
	p.Version = "1.0.0"
	p.Description = "recon agent"
	p.Requested.Tools = []string{"http_probe"}
	return p
}

type scriptedModel struct {
	script []string
	calls  int
}

func (m *scriptedModel) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.ChatResponse, error) {
	if m.calls >= len(m.script) {
		return nil, fmt.Errorf("no scripted reply for call %d", m.calls)
	}
	r := m.script[m.calls]
	m.calls++
	return &llm.ChatResponse{Content: r}, nil
}

func (m *scriptedModel) Stream(ctx context.Context, req *llm.ChatRequest) (llm.StreamReader, error) {
	return nil, errors.New("not implemented")
}

type recordingExec struct{ calls []invocation.InvokeParams }

func (e *recordingExec) InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error) {
	e.calls = append(e.calls, p)
	return invocation.Invocation{ID: uuid.New(), Status: invocation.StatusSucceeded}, output.Success(uuid.NewString(), "", ""), nil
}

type staticRuns struct {
	run   runs.Run
	agent runs.AgentInstance
}

func (r *staticRuns) GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error) { return r.run, nil }
func (r *staticRuns) GetTask(ctx context.Context, id uuid.UUID) (runs.Task, error) {
	return runs.Task{}, nil
}
func (r *staticRuns) GetAgent(ctx context.Context, id uuid.UUID) (runs.AgentInstance, error) {
	return r.agent, nil
}
func (r *staticRuns) TransitionAgent(ctx context.Context, id uuid.UUID, fromVersion int, to runs.AgentStatus) (runs.AgentInstance, error) {
	r.agent.Status = to
	r.agent.Version++
	return r.agent, nil
}

type allowGrants struct{}

func (allowGrants) CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error) {
	return true, nil
}

type staticResolver struct{ available map[string]bool }

func (r *staticResolver) Available(id string) bool { return r.available[id] }

type staticSource struct{ profile *content.Profile }

func (s *staticSource) LoadProfile(name string) (*content.Profile, error) { return s.profile, nil }
func (s *staticSource) LoadPrompt(ref string) (string, error)             { return "You are a recon agent.", nil }
func (s *staticSource) LoadSkill(name string) (*content.Skill, error)     { return &content.Skill{}, nil }

type agentRepo struct {
	attempts map[uuid.UUID]agents.Attempt
	messages map[uuid.UUID][]agents.Message
	snaps    map[uuid.UUID]agents.Snapshot
	n        int
}

func newAgentRepo() *agentRepo {
	return &agentRepo{attempts: map[uuid.UUID]agents.Attempt{}, messages: map[uuid.UUID][]agents.Message{}, snaps: map[uuid.UUID]agents.Snapshot{}}
}

func (r *agentRepo) id() uuid.UUID {
	r.n++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("eval-%d", r.n)))
}

func (r *agentRepo) CreateAttempt(ctx context.Context, p agents.CreateAttemptParams) (agents.Attempt, error) {
	no := 1
	for _, a := range r.attempts {
		if a.AgentID == p.AgentID && a.AttemptNo >= no {
			no = a.AttemptNo + 1
		}
	}
	id := r.id()
	now := time.Now().UTC()
	a := agents.Attempt{ID: id, AgentID: p.AgentID, AttemptNo: no, Status: agents.AttemptRunning, StartedAt: &now, CreatedAt: now, UpdatedAt: now}
	r.attempts[id] = a
	return a, nil
}

func (r *agentRepo) GetAttempt(ctx context.Context, id uuid.UUID) (agents.Attempt, error) {
	a, ok := r.attempts[id]
	if !ok {
		return agents.Attempt{}, &agents.ErrAttemptNotFound{ID: id}
	}
	return a, nil
}

func (r *agentRepo) ListAttemptsByAgent(ctx context.Context, agentID uuid.UUID) ([]agents.Attempt, error) {
	out := make([]agents.Attempt, 0)
	for _, a := range r.attempts {
		if a.AgentID == agentID {
			out = append(out, a)
		}
	}
	return out, nil
}

func (r *agentRepo) FinishAttempt(ctx context.Context, p agents.FinishAttemptParams) (agents.Attempt, error) {
	a, ok := r.attempts[p.ID]
	if !ok {
		return agents.Attempt{}, &agents.ErrAttemptNotFound{ID: p.ID}
	}
	a.Status = p.Status
	ft := p.FinishedAt
	a.FinishedAt = &ft
	r.attempts[p.ID] = a
	return a, nil
}

func (r *agentRepo) AppendMessage(ctx context.Context, p agents.AppendMessageParams) (agents.Message, error) {
	m := agents.Message{ID: r.id(), AttemptID: p.AttemptID, Seq: p.Seq, Role: p.Role, Content: p.Content, InvocationID: p.InvocationID}
	r.messages[p.AttemptID] = append(r.messages[p.AttemptID], m)
	return m, nil
}

func (r *agentRepo) ListMessages(ctx context.Context, attemptID uuid.UUID) ([]agents.Message, error) {
	return append([]agents.Message{}, r.messages[attemptID]...), nil
}

func (r *agentRepo) CreateSnapshot(ctx context.Context, p agents.CreateSnapshotParams) (agents.Snapshot, error) {
	s := agents.Snapshot{ID: r.id(), AgentID: p.AgentID, ProfileRef: p.ProfileRef, ContentHash: p.ContentHash, Requested: p.Requested, Granted: p.Granted, CreatedAt: time.Now().UTC()}
	r.snaps[s.ID] = s
	return s, nil
}

func (r *agentRepo) GetSnapshotByAgent(ctx context.Context, agentID uuid.UUID) (agents.Snapshot, error) {
	for _, s := range r.snaps {
		if s.AgentID == agentID {
			return s, nil
		}
	}
	return agents.Snapshot{}, &agents.ErrSnapshotNotFound{AgentID: agentID}
}
