package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

// reconProfileManifest is the agent profile the integration test runs.
const reconProfileManifest = `apiVersion: manifest/v1
kind: profile
name: recon
description: recon agent
license: Apache-2.0
promptRefs: [agents/prompts/recon-system.md]
requested:
  tools: [http_probe]
model: profile-model
`

// TestPhase5AgentDataFlow is opt-in (RAP_TEST_DATABASE_URL). It exercises the
// Phase 5 acceptance path through the composition root:
//
//	project + scope + member + grants -> authorized run -> agent attempt
//	(model chooses http_probe through execution) -> evidence -> finding draft
//	-> verifier re-checks through execution -> verdict.
//
// A scripted OpenAI-compatible provider stands in for the model so the test is
// deterministic and needs no API key.
func TestPhase5AgentDataFlow(t *testing.T) {
	dsn := requireTestDSN(t)

	// Deterministic lab endpoint the agent probes and the verifier re-checks.
	lab := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("lab-ok"))
	}))
	defer lab.Close()

	// Scripted model: step 1 requests http_probe against the lab, step 2 finishes
	// with a finding draft.
	step := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		if request.Stream {
			t.Error("agent must use non-streaming Chat")
		}
		var content string
		if step == 0 {
			content = fmt.Sprintf(`{"action":"tool","capability":"http_probe","args":{"url":%q}}`, lab.URL)
		} else {
			content = `{"action":"final","summary":"lab endpoint reachable","finding_draft":{"title":"Lab endpoint reachable","description":"probe returned 200","severity":"low","confidence":"high"}}`
		}
		step++
		resp := map[string]any{
			"id": "chat-1", "object": "chat.completion", "created": 1, "model": request.Model,
			"choices": []map[string]any{{
				"index":         0,
				"message":       map[string]string{"role": "assistant", "content": content},
				"finish_reason": "stop",
			}},
			"usage": map[string]int{"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer provider.Close()

	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writeFixture(t, contentRoot, "agents/profiles/recon.yaml", reconProfileManifest)
	writeFixture(t, contentRoot, "agents/prompts/recon-system.md", "You are a recon agent.\n")
	writeFixture(t, contentRoot, "tools/manifests/http_probe.yaml", httpProbeManifest)

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = dsn
	cfg.LLM.BaseURL = provider.URL
	cfg.LLM.APIKey = "test-key"
	cfg.LLM.Model = "profile-model"
	cfg.LLM.Timeout = 5 * time.Second

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	if a.services.Agents == nil || a.services.Verifier == nil {
		t.Fatal("agent/verifier services were not wired")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase5-%d", time.Now().UnixNano())
	proj, err := a.services.Projects.CreateProject(ctx, "Phase5", slug)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	scope, err := a.services.Projects.CreateScope(ctx, projects.CreateScopeParams{
		ProjectID: proj.ID, AssetTypes: []string{"endpoint"},
	})
	if err != nil {
		t.Fatalf("create scope: %v", err)
	}
	if _, err := a.services.Projects.AddMember(ctx, proj.ID, actor, projects.RoleOwner); err != nil {
		t.Fatalf("add member: %v", err)
	}

	if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
		Subject: actor, ScopeID: scope.ID, Capability: CapabilityRunStart, GrantedBy: grantor,
	}); err != nil {
		t.Fatalf("grant run.start: %v", err)
	}
	if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
		Subject: actor, ScopeID: scope.ID, Capability: "http_probe", GrantedBy: grantor,
	}); err != nil {
		t.Fatalf("grant http_probe: %v", err)
	}
	run, err := a.services.StartAuthorizedRun(ctx, StartRunParams{
		ProjectID: proj.ID, ScopeID: scope.ID, Actor: actor, Name: "recon",
	})
	if err != nil {
		t.Fatalf("authorized start: %v", err)
	}
	if _, err := a.services.Runs.TransitionRun(ctx, run.ID, run.Version, runs.RunRunning); err != nil {
		t.Fatalf("transition run: %v", err)
	}
	task, err := a.services.Runs.CreateTask(ctx, run.ID, "probe-lab", runs.TaskQueued)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	// Cleanup in dependency order: invocations (scope RESTRICT), project cascade,
	// then artifacts whose run_id was set null by the cascade.
	t.Cleanup(func() {
		db := a.pool.DB()
		bg := context.Background()
		_, _ = db.Exec(bg, "DELETE FROM tool_invocations WHERE run_id = $1", run.ID)
		_, _ = db.Exec(bg, "DELETE FROM projects WHERE slug = $1", slug)
		_, _ = db.Exec(bg, "DELETE FROM artifacts WHERE run_id = $1", run.ID)
	})

	res, err := a.services.RunAgent(ctx, RunAgentParams{
		RunID: run.ID, TaskID: &task.ID, Profile: "recon", ScopeID: scope.ID, Actor: actor, Task: "probe the lab endpoint",
	})
	if err != nil {
		t.Fatalf("RunAgent: %v", err)
	}
	if res.Attempt.Status != agents.AttemptSucceeded {
		t.Fatalf("attempt status = %s, want succeeded", res.Attempt.Status)
	}
	if res.FindingID == nil {
		t.Fatal("agent did not produce a finding draft")
	}
	if res.Verdict == nil || *res.Verdict != findings.VerdictConfirmed {
		t.Fatalf("verdict = %v, want confirmed", res.Verdict)
	}

	// The agent's tool call went through execution and is durably recorded.
	invs, err := a.services.Execution.ListByRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("list invocations: %v", err)
	}
	if len(invs) < 2 {
		t.Fatalf("invocations = %d, want >= 2 (agent + verifier)", len(invs))
	}
	succeeded := 0
	for _, inv := range invs {
		if inv.Status == "succeeded" {
			succeeded++
		}
	}
	if succeeded < 2 {
		t.Fatalf("succeeded invocations = %d, want >= 2", succeeded)
	}

	// The agent attempt and conversation are recorded, and a tool turn links to
	// its invocation.
	attempts, err := a.services.Agents.ListAttempts(ctx, res.AgentID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) == 0 || attempts[0].Status != agents.AttemptSucceeded {
		t.Fatalf("attempts = %+v", attempts)
	}
	messages, err := a.services.Agents.ListMessages(ctx, attempts[0].ID)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	var toolTurn bool
	for _, m := range messages {
		if m.Role == agents.RoleTool && m.InvocationID != nil {
			toolTurn = true
		}
	}
	if !toolTurn {
		t.Fatalf("no tool turn linked to an invocation: %+v", messages)
	}

	// The finding draft is linked to the evidence the tool produced, and the
	// verdict did not change the finding status (still draft).
	finding, err := a.services.Findings.GetFinding(ctx, *res.FindingID)
	if err != nil {
		t.Fatalf("get finding: %v", err)
	}
	if finding.Status != findings.StatusDraft {
		t.Fatalf("finding status = %s, want draft (verdict must not transition)", finding.Status)
	}
	verdicts, err := a.services.Findings.ListVerdicts(ctx, finding.ID)
	if err != nil {
		t.Fatalf("list verdicts: %v", err)
	}
	if len(verdicts) != 1 || verdicts[0].Verdict != findings.VerdictConfirmed {
		t.Fatalf("verdicts = %+v", verdicts)
	}

	// Evidence bytes produced by the tool are readable through the invocation's
	// raw artifact reference (the invocation is the run-scoped provenance link).
	var rawArtifactID *uuid.UUID
	for _, inv := range invs {
		if inv.RawArtifactID != nil {
			rawArtifactID = inv.RawArtifactID
			break
		}
	}
	if rawArtifactID == nil {
		t.Fatal("no invocation recorded a raw artifact")
	}
	art, err := a.services.Evidence.GetArtifact(ctx, *rawArtifactID)
	if err != nil {
		t.Fatalf("get artifact: %v", err)
	}
	rc, err := a.services.Evidence.ReadRef(ctx, art)
	if err != nil {
		t.Fatalf("read artifact: %v", err)
	}
	defer rc.Close()
	body, _ := io.ReadAll(rc)
	if len(body) == 0 {
		t.Fatal("artifact body is empty")
	}
}
