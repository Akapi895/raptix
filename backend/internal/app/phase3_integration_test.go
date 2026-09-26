package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/workspace/assessment"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

// requireTestDSN returns the opt-in test database DSN. It skips locally when
// unset, but fails hard under CI so a misconfigured pipeline cannot silently
// turn the Phase 3 acceptance test into a green no-op.
func requireTestDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("RAP_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("RAP_TEST_DATABASE_URL must be set in CI: the Phase 3 integration test is required")
		}
		t.Skip("set RAP_TEST_DATABASE_URL to run Phase 3 integration test")
	}
	return dsn
}

// TestPhase3IntegrationDataFlow is opt-in: set RAP_TEST_DATABASE_URL to a
// dedicated test database (CI provisions raptix_test and applies migrations
// before the suite runs). It exercises the full Phase 3 acceptance path through
// the composition root:
//
//	project + scope + member -> authorized run start (with a denied attempt) ->
//	run read-back -> task/agent -> real artifact bytes (write + checksum + read) ->
//	observation/hypothesis/coverage -> finding draft + evidence + verdict.
//
// It is repeatable because the project slug is unique per run and no prior
// database state is assumed beyond applied migrations.
func TestPhase3IntegrationDataFlow(t *testing.T) {
	dsn := requireTestDSN(t)

	cfg := defaults()
	root := t.TempDir()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = filepath.Join(root, "content")
	cfg.Database.URL = dsn

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	actor := "alice"
	grantor := "bob"

	slug := fmt.Sprintf("acme-%d", time.Now().UnixNano())
	proj, err := a.services.Projects.CreateProject(ctx, "Acme", slug)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	// Remove the project (and, by cascade, its scopes/runs/findings) so repeated
	// runs against a shared database do not accumulate rows.
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM projects WHERE slug = $1", slug)
	})
	projRead, err := a.services.Projects.GetProjectByID(ctx, proj.ID)
	if err != nil {
		t.Fatalf("project read-back: %v", err)
	}
	if projRead.Name != "Acme" || projRead.Status != projects.ProjectActive {
		t.Fatalf("project read-back mismatch: %+v", projRead)
	}

	scope, err := a.services.Projects.CreateScope(ctx, projects.CreateScopeParams{
		ProjectID: proj.ID, AssetTypes: []string{"endpoint"},
	})
	if err != nil {
		t.Fatalf("create scope: %v", err)
	}
	if scope.Version != 1 {
		t.Fatalf("scope version = %d, want 1", scope.Version)
	}
	// A second scope must receive the next version.
	scope2, err := a.services.Projects.CreateScope(ctx, projects.CreateScopeParams{
		ProjectID: proj.ID, AssetTypes: []string{"host"},
	})
	if err != nil {
		t.Fatalf("create second scope: %v", err)
	}
	if scope2.Version != 2 {
		t.Fatalf("second scope version = %d, want 2", scope2.Version)
	}

	if _, err := a.services.Projects.AddMember(ctx, proj.ID, actor, projects.RoleOwner); err != nil {
		t.Fatalf("add member: %v", err)
	}

	// A member without the run.start grant must be denied.
	if _, err := a.services.StartAuthorizedRun(ctx, StartRunParams{
		ProjectID: proj.ID, ScopeID: scope.ID, Actor: actor, Name: "unauthorized recon",
	}); err == nil {
		t.Fatal("expected authorization denial before granting run.start")
	} else if _, ok := err.(*ErrRunUnauthorized); !ok {
		t.Fatalf("expected ErrRunUnauthorized, got %v", err)
	}

	// Grant within the active scope, then start the run.
	if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
		Subject: actor, ScopeID: scope.ID, Capability: CapabilityRunStart, GrantedBy: grantor,
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	run, err := a.services.StartAuthorizedRun(ctx, StartRunParams{
		ProjectID: proj.ID, ScopeID: scope.ID, Actor: actor, Name: "recon", RequestKey: "run-start-1",
	})
	if err != nil {
		t.Fatalf("authorized start: %v", err)
	}
	if run.Status != runs.RunQueued {
		t.Fatalf("run status = %s, want queued", run.Status)
	}
	replay, err := a.services.StartAuthorizedRun(ctx, StartRunParams{
		ProjectID: proj.ID, ScopeID: scope.ID, Actor: actor, Name: "recon", RequestKey: "run-start-1",
	})
	if err != nil || replay.ID != run.ID {
		t.Fatalf("idempotent run replay = %+v, %v", replay, err)
	}

	// Run must be readable back through the service.
	gotRun, err := a.services.Runs.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("run read-back: %v", err)
	}
	if gotRun.ID != run.ID || gotRun.ProjectID != proj.ID || gotRun.ScopeID != scope.ID || gotRun.CreatedBy != actor {
		t.Fatalf("run read-back mismatch: %+v", gotRun)
	}

	// Lifecycle: move the run to running; create a task and an agent tied to it.
	if _, err := a.services.Runs.TransitionRun(ctx, run.ID, run.Version, runs.RunRunning); err != nil {
		t.Fatalf("transition run: %v", err)
	}
	task, err := a.services.Runs.CreateTask(ctx, run.ID, "nmap-recon", runs.TaskQueued)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := a.services.Runs.TransitionTask(ctx, task.ID, task.Version, runs.TaskRunning); err != nil {
		t.Fatalf("transition task: %v", err)
	}
	agent, err := a.services.Runs.CreateAgent(ctx, run.ID, &task.ID, "recon-agent")
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	if agent.TaskID == nil || *agent.TaskID != task.ID {
		t.Fatalf("agent not tied to task: %+v", agent)
	}

	// Evidence: real bytes written through the blob store at a content-addressed
	// key, checksummed by the service, then read back to prove persistence.
	payload := "GET /login HTTP/1.1 200 OK"
	runID := run.ID
	art, err := a.services.Evidence.Register(ctx, evidence.RegisterParams{
		RunID: &runID, Kind: evidence.KindRaw, MIME: "text/plain",
		Sensitivity: evidence.SensitivityLow,
	}, strings.NewReader(payload))
	if err != nil {
		t.Fatalf("register artifact: %v", err)
	}
	// artifacts.run_id is ON DELETE SET NULL, so deleting the project would not
	// remove the artifact row; clean it up by its derived storage key (registered
	// after the project cleanup, so it runs first).
	storageKey := art.StorageKey
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM artifacts WHERE storage_key = $1", storageKey)
	})
	wantSHA, _ := evidence.NewSHA256(strings.NewReader(payload))
	if art.SHA256 != wantSHA || art.Size != int64(len(payload)) {
		t.Fatalf("computed checksum/size = %s/%d, want %s/%d", art.SHA256, art.Size, wantSHA, len(payload))
	}
	if got, err := a.services.Evidence.GetBySHA256InRun(ctx, run.ID, art.SHA256); err != nil || got.ID != art.ID {
		t.Fatalf("run-qualified sha lookup: got=%+v err=%v", got, err)
	}
	reader, err := a.services.Evidence.ReadRef(ctx, art)
	if err != nil {
		t.Fatalf("read artifact bytes: %v", err)
	}
	defer reader.Close()
	readBack, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read artifact content: %v", err)
	}
	if string(readBack) != payload {
		t.Fatalf("artifact bytes mismatch: got %q, want %q", string(readBack), payload)
	}

	// Assessment: asset + observation + hypothesis + coverage backed by evidence.
	asset, err := a.services.Assessment.RecordAsset(ctx, assessment.CreateAssetParams{
		RunID: run.ID, Kind: "endpoint", Name: "https://api.acme.test/login",
		Properties: map[string]interface{}{"host": "api.acme.test"},
	})
	if err != nil {
		t.Fatalf("record asset: %v", err)
	}
	obs, err := a.services.Assessment.RecordObservation(ctx, assessment.CreateObservationParams{
		RunID: run.ID, AssetID: &asset.ID, Summary: "login endpoint responds 200", EvidenceID: &art.ID,
	})
	if err != nil {
		t.Fatalf("record observation: %v", err)
	}
	if got, err := a.services.Assessment.GetObservation(ctx, obs.ID); err != nil || got.Summary != "login endpoint responds 200" {
		t.Fatalf("observation read-back: %+v err=%v", got, err)
	}
	hyp, err := a.services.Assessment.RecordHypothesis(ctx, assessment.CreateHypothesisParams{
		RunID: run.ID, Title: "missing security headers",
	})
	if err != nil {
		t.Fatalf("record hypothesis: %v", err)
	}
	if _, err := a.services.Assessment.SetHypothesisStatus(ctx, hyp.ID, assessment.HypothesisInvestigating); err != nil {
		t.Fatalf("set hypothesis status: %v", err)
	}
	// verified_negative requires evidence (enforced by the service).
	if _, err := a.services.Assessment.RecordCoverage(ctx, assessment.CreateCoverageParams{
		RunID: run.ID, AssetID: &asset.ID, Method: "detect-technologies",
		Outcome: assessment.OutcomeVerifiedNegative, EvidenceID: &art.ID,
	}); err != nil {
		t.Fatalf("record coverage: %v", err)
	}

	// Findings: draft + evidence link; verdict must not flip status.
	f, err := a.services.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID: run.ID, Title: "Missing security headers",
		Severity: findings.SeverityMedium, Confidence: findings.ConfidenceLow,
		Evidence: []findings.EvidenceRef{{EvidenceID: art.ID, Role: "supporting"}},
	})
	if err != nil {
		t.Fatalf("create finding: %v", err)
	}
	if f.Status != findings.StatusDraft {
		t.Fatalf("finding status = %s, want draft", f.Status)
	}
	reviewed, err := a.services.Findings.TransitionStatus(ctx, f.ID, f.Version, findings.StatusReviewed, "bob", "reviewed in integration")
	if err != nil {
		t.Fatalf("transition finding: %v", err)
	}
	if reviewed.Status != findings.StatusReviewed || reviewed.Version != 2 {
		t.Fatalf("reviewed = %+v", reviewed)
	}
	revision, err := a.services.Findings.GetCurrentRevision(ctx, f.ID)
	if err != nil {
		t.Fatalf("get finding revision: %v", err)
	}
	if _, err := a.services.Findings.RecordVerdict(ctx, findings.InsertVerdictParams{
		FindingID: f.ID, RevisionNo: revision.RevisionNo, Verdict: findings.VerdictConfirmed, Reason: "seen in response", ProducedBy: "verifier-a",
	}); err != nil {
		t.Fatalf("record verdict: %v", err)
	}
	after, err := a.services.Findings.GetFinding(ctx, f.ID)
	if err != nil {
		t.Fatalf("finding read-back: %v", err)
	}
	if after.Status != reviewed.Status {
		t.Fatalf("verdict unexpectedly changed status to %s", after.Status)
	}
	history, err := a.services.Findings.ListReviewHistory(ctx, f.ID)
	if err != nil {
		t.Fatalf("review history read-back: %v", err)
	}
	if len(history) != 1 || history[0].FromStatus != findings.StatusDraft || history[0].ToStatus != findings.StatusReviewed {
		t.Fatalf("review history = %+v", history)
	}
}

// TestPhase3ConcurrentScopeVersions proves scope version allocation is
// concurrency-safe: many concurrent CreateScope calls must all succeed with
// distinct versions (1..N), not collide on a MAX(version) read.
func TestPhase3ConcurrentScopeVersions(t *testing.T) {
	dsn := requireTestDSN(t)
	cfg := defaults()
	root := t.TempDir()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = filepath.Join(root, "content")
	cfg.Database.URL = dsn

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	slug := fmt.Sprintf("conc-%d", time.Now().UnixNano())
	proj, err := a.services.Projects.CreateProject(ctx, "Conc", slug)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM projects WHERE slug = $1", slug)
	})

	const n = 8
	versions := make([]int, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s, err := a.services.Projects.CreateScope(ctx, projects.CreateScopeParams{
				ProjectID: proj.ID, AssetTypes: []string{"host"},
			})
			if err != nil {
				errs[i] = err
				return
			}
			versions[i] = s.Version
		}(i)
	}
	wg.Wait()

	seen := map[int]bool{}
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("scope %d failed: %v", i, errs[i])
		}
		if seen[versions[i]] {
			t.Fatalf("duplicate scope version %d: %v", versions[i], versions)
		}
		seen[versions[i]] = true
	}
	for v := 1; v <= n; v++ {
		if !seen[v] {
			t.Fatalf("missing scope version %d: %v", v, versions)
		}
	}
}
