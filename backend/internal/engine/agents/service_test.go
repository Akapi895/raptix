package agents

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

type fakeSource struct{ profile *content.Profile }

func (f *fakeSource) LoadProfile(name string) (*content.Profile, error) { return f.profile, nil }
func (f *fakeSource) LoadPrompt(ref string) (string, error)             { return "", nil }
func (f *fakeSource) LoadSkill(name string) (*content.Skill, error)     { return &content.Skill{}, nil }

type fakeModel struct {
	replies []string
	calls   int
	block   bool
}

func (f *fakeModel) Chat(ctx context.Context, req *llm.ChatRequest) (*llm.ChatResponse, error) {
	if f.block {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if f.calls >= len(f.replies) {
		return nil, fmt.Errorf("no scripted reply for call %d", f.calls)
	}
	r := f.replies[f.calls]
	f.calls++
	return &llm.ChatResponse{Content: r}, nil
}

func (f *fakeModel) Stream(ctx context.Context, req *llm.ChatRequest) (llm.StreamReader, error) {
	return nil, errors.New("stream not implemented")
}

type fakeExec struct {
	calls  []invocation.InvokeParams
	result *output.Result
	err    error
}

func (f *fakeExec) InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error) {
	f.calls = append(f.calls, p)
	if f.err != nil {
		return invocation.Invocation{}, nil, f.err
	}
	return invocation.Invocation{ID: uuid.New(), Status: invocation.StatusSucceeded}, f.result, nil
}

type fakeRuns struct {
	run         runs.Run
	agent       runs.AgentInstance
	task        runs.Task
	transitions []runs.AgentStatus
}

func (f *fakeRuns) GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error) { return f.run, nil }
func (f *fakeRuns) GetTask(ctx context.Context, id uuid.UUID) (runs.Task, error) {
	return f.task, nil
}
func (f *fakeRuns) GetAgent(ctx context.Context, id uuid.UUID) (runs.AgentInstance, error) {
	return f.agent, nil
}
func (f *fakeRuns) TransitionAgent(ctx context.Context, id uuid.UUID, fromVersion int, to runs.AgentStatus) (runs.AgentInstance, error) {
	f.transitions = append(f.transitions, to)
	f.agent.Status = to
	f.agent.Version++
	return f.agent, nil
}

type fakeGrants struct {
	ok  bool
	err error
}

func (f *fakeGrants) CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error) {
	return f.ok, f.err
}

type fakeResolver struct{ available map[string]bool }

func (f *fakeResolver) Available(id string) bool { return f.available[id] }

// finishConflictRepo simulates cancellation winning after the agent loop exits
// but before it persists its own terminal outcome.
type finishConflictRepo struct{ *memRepo }

func (r *finishConflictRepo) FinishAttempt(ctx context.Context, p FinishAttemptParams) (Attempt, error) {
	if _, err := r.memRepo.FinishAttempt(ctx, FinishAttemptParams{
		ID: p.ID, Status: AttemptCancelled, FinishedAt: p.FinishedAt,
	}); err != nil {
		return Attempt{}, err
	}
	return Attempt{}, &ErrAttemptNotRunning{ID: p.ID}
}

func reconProfile() *content.Profile {
	p := &content.Profile{Model: "test-model"}
	p.Name = "recon"
	p.Version = "1.0.0"
	p.Description = "recon agent"
	p.Requested.Tools = []string{"http_probe"}
	return p
}

type harness struct {
	svc    *Service
	repo   *memRepo
	model  *fakeModel
	exec   *fakeExec
	runs   *fakeRuns
	grants *fakeGrants
	agent  runs.AgentInstance
	scope  uuid.UUID
}

func newHarness(replies ...string) *harness {
	agent := runs.AgentInstance{ID: uuid.New(), RunID: uuid.New(), Profile: "recon", Status: runs.AgentPaused, Version: 1}
	fr := &fakeRuns{
		run:   runs.Run{ID: agent.RunID, Status: runs.RunRunning},
		agent: agent,
	}
	model := &fakeModel{replies: replies}
	exec := &fakeExec{result: output.Success(uuid.NewString(), "", "")}
	builder := contextbuild.NewBuilder(&fakeSource{profile: reconProfile()}, contextbuild.Budget{MaxTokens: 4000})
	svc := NewService(newMemRepo(), model, builder, exec, fr, &fakeGrants{ok: true}, &fakeResolver{available: map[string]bool{"http_probe": true}}, Config{MaxSteps: 5, DefaultTimeout: time.Second, Model: "test-model"}, nil)
	return &harness{svc: svc, repo: svc.repo.(*memRepo), model: model, exec: exec, runs: fr, grants: svc.grants.(*fakeGrants), agent: agent, scope: uuid.New()}
}

func (h *harness) run(t *testing.T) AttemptResult {
	t.Helper()
	res, err := h.svc.RunAgent(context.Background(), RunParams{AgentID: h.agent.ID, ScopeID: h.scope, Actor: "alice", Task: "probe the lab"})
	if err != nil {
		t.Fatalf("RunAgent: %v", err)
	}
	return res
}

func TestRunAgentToolThenFinal(t *testing.T) {
	h := newHarness(
		`{"action":"tool","capability":"http_probe","args":{"url":"http://lab"}}`,
		`{"action":"final","summary":"lab reachable","finding_draft":{"title":"open endpoint","severity":"medium","confidence":"low"}}`,
	)
	res := h.run(t)
	if res.Attempt.Status != AttemptSucceeded {
		t.Fatalf("attempt = %+v", res.Attempt)
	}
	if res.Draft == nil || res.Draft.Title != "open endpoint" {
		t.Fatalf("draft = %+v", res.Draft)
	}
	if len(res.EvidenceIDs) != 1 {
		t.Errorf("evidence ids = %v", res.EvidenceIDs)
	}
	if len(h.exec.calls) != 1 {
		t.Fatalf("exec calls = %d, want 1", len(h.exec.calls))
	}
	call := h.exec.calls[0]
	if call.Capability != "http_probe" || call.Actor != "alice" || call.ScopeID != h.scope {
		t.Errorf("dispatch params = %+v", call)
	}
	wantKey := h.attemptID(t) + ":0"
	if call.IdempotencyKey != wantKey {
		t.Errorf("idempotency key = %q, want %q", call.IdempotencyKey, wantKey)
	}
	if got := h.runs.transitions; len(got) != 2 || got[0] != runs.AgentRunning || got[1] != runs.AgentCompleted {
		t.Errorf("transitions = %v", got)
	}
}

func (h *harness) attemptID(t *testing.T) string {
	t.Helper()
	attempts, err := h.repo.ListAttemptsByAgent(context.Background(), h.agent.ID)
	if err != nil || len(attempts) == 0 {
		t.Fatalf("attempts = %v err=%v", attempts, err)
	}
	return attempts[0].ID.String()
}

func TestRunAgentDeniedFailsAttempt(t *testing.T) {
	h := newHarness(`{"action":"tool","capability":"http_probe","args":{}}`)
	h.exec.result = output.Denied("no grant")
	res := h.run(t)
	if res.Attempt.Status != AttemptFailed {
		t.Errorf("status = %s, want failed", res.Attempt.Status)
	}
	if h.runs.transitions[len(h.runs.transitions)-1] != runs.AgentFailed {
		t.Errorf("agent transition = %v, want failed", h.runs.transitions)
	}
}

func TestRunAgentParseFailureFailsAttempt(t *testing.T) {
	h := newHarness("this is not json")
	res := h.run(t)
	if res.Attempt.Status != AttemptFailed {
		t.Errorf("status = %s, want failed", res.Attempt.Status)
	}
	if len(h.exec.calls) != 0 {
		t.Error("no tool should run when the action cannot be parsed")
	}
}

func TestRunAgentStepBudgetExhausted(t *testing.T) {
	// Always request a tool; the step budget ends the attempt.
	reply := `{"action":"tool","capability":"http_probe","args":{}}`
	h := newHarness(reply, reply, reply)
	h.svc.cfg.MaxSteps = 3
	res := h.run(t)
	if res.Attempt.Status != AttemptFailed {
		t.Errorf("status = %s, want failed", res.Attempt.Status)
	}
	if len(h.exec.calls) != 3 {
		t.Errorf("exec calls = %d, want 3", len(h.exec.calls))
	}
}

func TestRunAgentTimeoutMapsToTimedOut(t *testing.T) {
	h := newHarness()
	h.model.block = true
	h.svc.cfg.DefaultTimeout = 20 * time.Millisecond
	res, err := h.svc.RunAgent(context.Background(), RunParams{AgentID: h.agent.ID, ScopeID: h.scope, Actor: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Attempt.Status != AttemptTimedOut {
		t.Errorf("status = %s, want timed_out", res.Attempt.Status)
	}
	if h.runs.transitions[len(h.runs.transitions)-1] != runs.AgentFailed {
		t.Errorf("agent transition = %v, want failed", h.runs.transitions)
	}
}

func TestRunAgentRejectsTerminalRun(t *testing.T) {
	h := newHarness()
	h.runs.run.Status = runs.RunCancelled
	if _, err := h.svc.RunAgent(context.Background(), RunParams{AgentID: h.agent.ID, ScopeID: h.scope, Actor: "alice"}); err == nil {
		t.Error("expected error for a cancelled run")
	}
}

func TestRunAgentWithoutModel(t *testing.T) {
	h := newHarness()
	h.svc.model = nil
	if _, err := h.svc.RunAgent(context.Background(), RunParams{AgentID: h.agent.ID, ScopeID: h.scope, Actor: "alice"}); !errors.Is(err, ErrModelUnavailable) {
		t.Errorf("err = %v, want ErrModelUnavailable", err)
	}
}

func TestResolveSnapshotRecordsGranted(t *testing.T) {
	h := newHarness()
	resolved, err := h.svc.builder.Resolve(context.Background(), "recon")
	if err != nil {
		t.Fatal(err)
	}
	snap, err := h.svc.resolveSnapshot(context.Background(), h.agent, resolved, h.scope, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if snap.ProfileRef != "recon@1.0.0" {
		t.Errorf("profile ref = %q", snap.ProfileRef)
	}
	if string(snap.Granted) != `{"http_probe":true}` {
		t.Errorf("granted = %s", snap.Granted)
	}
	if string(snap.Requested) == "" {
		t.Error("requested snapshot is empty")
	}
}

func TestCancelRunningAttempts(t *testing.T) {
	h := newHarness()
	ctx := context.Background()

	a1, err := h.repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: h.agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	a2, err := h.repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: h.agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	// A finished attempt must be left untouched.
	finished, err := h.repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: h.agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.repo.FinishAttempt(ctx, FinishAttemptParams{ID: finished.ID, Status: AttemptSucceeded, FinishedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}

	n, err := h.svc.CancelRunningAttempts(ctx, h.agent.ID)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if n != 2 {
		t.Errorf("cancelled = %d, want 2", n)
	}
	for _, id := range []uuid.UUID{a1.ID, a2.ID} {
		got, _ := h.repo.GetAttempt(ctx, id)
		if got.Status != AttemptCancelled {
			t.Errorf("attempt %s status = %s, want cancelled", id, got.Status)
		}
	}
	if _, err := h.repo.FinishAttempt(ctx, FinishAttemptParams{ID: a1.ID, Status: AttemptSucceeded, FinishedAt: time.Now().UTC()}); err == nil {
		t.Error("completion must not overwrite a cancelled attempt")
	}
	gotFinished, _ := h.repo.GetAttempt(ctx, finished.ID)
	if gotFinished.Status != AttemptSucceeded {
		t.Errorf("finished attempt status = %s, want succeeded untouched", gotFinished.Status)
	}
}

func TestRunAgentDoesNotOverwriteCancelledAttempt(t *testing.T) {
	h := newHarness(`{"action":"final","summary":"done"}`)
	h.svc.repo = &finishConflictRepo{memRepo: h.repo}

	res := h.run(t)
	if res.Attempt.Status != AttemptCancelled {
		t.Fatalf("attempt status = %s, want cancelled", res.Attempt.Status)
	}
	if got := h.runs.transitions; len(got) != 1 || got[0] != runs.AgentRunning {
		t.Errorf("transitions = %v, want only transition to running", got)
	}
}
