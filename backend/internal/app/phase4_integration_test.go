package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// httpProbeManifest is the minimal declared capability the integration test
// binds to the builtin implementation.
const httpProbeManifest = `apiVersion: manifest/v1
kind: tool
name: http_probe
version: 1.0.0
description: probe a URL and record the raw response
license: Apache-2.0
executor:
  type: builtin
runtime:
  container: false
  network: true
input:
  type: object
  properties:
    url: { type: string }
  required: [url]
output:
  type: object
source:
  repo: raptix
  path: tools/builtin/http_probe.go
`

// TestPhase4InvokeCapabilityDataFlow is opt-in (RAP_TEST_DATABASE_URL). It
// exercises the Phase 4 acceptance path through the composition root:
//
//	project + scope + member + grants -> authorized run start -> invoke
//	http_probe through execution -> raw evidence artifact + succeeded invocation,
//	then a denied attempt for an actor without a grant.
//
// The capability is a builtin (no sandbox needed) so the test stays
// deterministic; the command/sandbox path is covered by unit tests.
func TestPhase4InvokeCapabilityDataFlow(t *testing.T) {
	dsn := requireTestDSN(t)

	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writeFixture(t, contentRoot, "tools/manifests/http_probe.yaml", httpProbeManifest)

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = dsn
	cfg.Execution.MaxInvocationsPerRun = 0 // unlimited; budget is covered by unit tests

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	if !a.allTools.Available("http_probe") {
		t.Fatal("http_probe implementation was not bound from its manifest")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// A deterministic lab endpoint stands in for the fixture lab.
	lab := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("lab-ok"))
	}))
	defer lab.Close()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase4-%d", time.Now().UnixNano())
	proj, err := a.services.Projects.CreateProject(ctx, "Phase4", slug)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	// LIFO cleanup: invocations (registered later) are removed before the project
	// cascade, because tool_invocations.scope_id is ON DELETE RESTRICT.
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM projects WHERE slug = $1", slug)
	})

	scope, err := a.services.Projects.CreateScope(ctx, projects.CreateScopeParams{
		ProjectID: proj.ID, AssetTypes: []string{"endpoint"},
	})
	if err != nil {
		t.Fatalf("create scope: %v", err)
	}
	if _, err := a.services.Projects.AddMember(ctx, proj.ID, actor, projects.RoleOwner); err != nil {
		t.Fatalf("add member: %v", err)
	}

	// Start an authorized run: needs the run.start grant.
	if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
		Subject: actor, ScopeID: scope.ID, Capability: CapabilityRunStart, GrantedBy: grantor,
	}); err != nil {
		t.Fatalf("grant run.start: %v", err)
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
	// Remove the run's invocations before the project cascade (scope RESTRICT).
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM tool_invocations WHERE run_id = $1", run.ID)
	})

	// Without a capability grant the actor is denied and nothing is dispatched.
	deniedInv, deniedRes, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "denied-1",
	})
	if err != nil {
		t.Fatalf("invoke (denied): %v", err)
	}
	if deniedInv.Status != invocation.StatusDenied || deniedRes.Execution != output.ExecutionDenied {
		t.Fatalf("expected denial without a grant, got status=%s result=%s", deniedInv.Status, deniedRes.Execution)
	}

	// Grant the capability within the active scope, then invoke for real.
	if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
		Subject: actor, ScopeID: scope.ID, Capability: "http_probe", GrantedBy: grantor,
	}); err != nil {
		t.Fatalf("grant http_probe: %v", err)
	}
	inv, res, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "ok-1",
	})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if inv.Status != invocation.StatusSucceeded {
		t.Fatalf("invocation status = %s, want succeeded (result=%s)", inv.Status, res.Execution)
	}
	if res.Execution != output.ExecutionSuccess || res.RawRef == "" {
		t.Fatalf("result = %+v, want success with raw ref", res)
	}

	// The invocation is durably recorded and points at the raw artifact.
	stored, err := a.services.Execution.Get(ctx, inv.ID)
	if err != nil {
		t.Fatalf("invocation read-back: %v", err)
	}
	if stored.Status != invocation.StatusSucceeded || stored.RawArtifactID == nil {
		t.Fatalf("stored invocation = %+v", stored)
	}

	// The raw artifact bytes are the actual HTTP response the capability saw.
	art, err := a.services.Evidence.GetArtifact(ctx, *stored.RawArtifactID)
	if err != nil {
		t.Fatalf("get artifact: %v", err)
	}
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM artifacts WHERE storage_key = $1", art.StorageKey)
	})
	rc, err := a.services.Evidence.ReadRef(ctx, art)
	if err != nil {
		t.Fatalf("read artifact: %v", err)
	}
	defer rc.Close()
	body, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("read artifact bytes: %v", err)
	}
	if !strings.Contains(string(body), "lab-ok") {
		t.Fatalf("artifact body = %q, want it to contain lab-ok", string(body))
	}

	// Idempotency: the same key must not dispatch a second time.
	again, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "ok-1",
	})
	if err != nil {
		t.Fatalf("idempotent invoke: %v", err)
	}
	if again.ID != inv.ID {
		t.Fatalf("idempotent retry created a new invocation: %s != %s", again.ID, inv.ID)
	}

	// A capability-level failure is still a durable invocation with status
	// failed (the port is closed, so the probe cannot connect).
	failedInv, failedRes, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(`{"url":"http://127.0.0.1:1/"}`), IdempotencyKey: "fail-1",
	})
	if err != nil {
		t.Fatalf("invoke (failing): %v", err)
	}
	if failedInv.Status != invocation.StatusFailed || failedRes.Execution != output.ExecutionFailed {
		t.Fatalf("expected a failed invocation, got status=%s result=%s", failedInv.Status, failedRes.Execution)
	}
	storedFailed, err := a.services.Execution.Get(ctx, failedInv.ID)
	if err != nil {
		t.Fatalf("failed invocation read-back: %v", err)
	}
	if storedFailed.Status != invocation.StatusFailed {
		t.Fatalf("stored failed invocation = %+v", storedFailed)
	}

	// Every decision is audited.
	var allowed, denied int
	if err := a.pool.DB().QueryRow(ctx,
		"SELECT count(*) FROM audit_records WHERE action = $1 AND outcome = 'allowed'", "tool.invoke.http_probe").Scan(&allowed); err != nil {
		t.Fatalf("count allowed audits: %v", err)
	}
	if err := a.pool.DB().QueryRow(ctx,
		"SELECT count(*) FROM audit_records WHERE action = $1 AND outcome = 'denied'", "tool.invoke.http_probe").Scan(&denied); err != nil {
		t.Fatalf("count denied audits: %v", err)
	}
	if allowed < 1 || denied < 1 {
		t.Fatalf("audit records = allowed:%d denied:%d, want at least one of each", allowed, denied)
	}
}
