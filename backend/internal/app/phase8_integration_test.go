package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
	"github.com/Akapi895/raptix/backend/internal/workspace/reporting"
)

const reportTemplateFixture = `id: default
version: "1"
mime: text/markdown
hash: 2d1c981d89081fed51d2a74577b817ee146d0aa6e45882bf3d11658bbda935ff
body: |
  # Security Assessment Report

  **Run:** {{ .run.name }}
  **Status:** {{ .run.status }}

  ## Findings
  {{ range .findings }}
  ### {{ .revision.title }}

  - Severity: {{ .revision.severity }}
  - Confidence: {{ .revision.confidence }}
  - Status: {{ .revision.status }}

  {{ .revision.description }}
  {{ else }}
  No findings recorded.
  {{ end }}
`

// phase8App builds an App with a content root that declares the report template
// and the http_probe tool, mirroring the other integration setups.
func phase8App(t *testing.T, dsn string) *App {
	t.Helper()
	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writeFixture(t, contentRoot, "tools/manifests/http_probe.yaml", httpProbeManifest)
	writeFixture(t, contentRoot, "templates/reports/default.yaml", reportTemplateFixture)

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = dsn
	cfg.Execution.MaxInvocationsPerRun = 0
	cfg.Auth.DevelopmentPrincipal = "alice"

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	return a
}

// phase8Base creates a project, scope, member, the grants a report/review flow
// needs, and a running authorized run.
func phase8Base(t *testing.T, a *App, ctx context.Context, slug, actor, grantor string) (projects.Scope, runs.Run) {
	t.Helper()
	proj, err := a.services.Projects.CreateProject(ctx, "Phase8", slug)
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
	for _, capability := range []string{CapabilityRunStart, "report.create", "report.read", "finding.read", "finding.review"} {
		if _, err := a.services.Governance.GrantCapability(ctx, governance.CreateCapabilityGrantParams{
			Subject: actor, ScopeID: scope.ID, Capability: capability, GrantedBy: grantor,
		}); err != nil {
			t.Fatalf("grant %s: %v", capability, err)
		}
	}
	run, err := a.services.StartAuthorizedRun(ctx, StartRunParams{
		ProjectID: proj.ID, ScopeID: scope.ID, Actor: actor, Name: "phase8 run",
	})
	if err != nil {
		t.Fatalf("authorized start: %v", err)
	}
	if _, err := a.services.Runs.TransitionRun(ctx, run.ID, run.Version, runs.RunRunning); err != nil {
		t.Fatalf("transition run: %v", err)
	}
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM tool_invocations WHERE run_id = $1", run.ID)
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM projects WHERE slug = $1", slug)
	})
	return scope, run
}

// TestPhase8ReportRenderIdempotent proves a report captures an immutable
// snapshot and that duplicate worker delivery links exactly one output artifact.
func TestPhase8ReportRenderIdempotent(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase8App(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	slug := "phase8-report-" + uuid.NewString()[:8]
	_, run := phase8Base(t, a, ctx, slug, "alice", "bob")

	finding, err := a.services.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID: run.ID, Title: "Missing HSTS", Description: "no strict transport header",
		Severity: findings.SeverityMedium, Confidence: findings.ConfidenceHigh, Actor: "alice",
	})
	if err != nil {
		t.Fatalf("create finding: %v", err)
	}

	report, err := a.services.CreateAuthorizedReport(ctx, reportRequestParams{
		RunID: run.ID, TemplateID: "default", TemplateVersion: "1",
	})
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	if report.Status != reporting.StatusQueued {
		t.Fatalf("new report status = %s, want queued", report.Status)
	}

	// Duplicate worker delivery must converge to one completed report and one
	// linked output artifact.
	if err := a.services.Reporting.Render(ctx, report.ID, "worker-1"); err != nil {
		t.Fatalf("render: %v", err)
	}
	if err := a.services.Reporting.Render(ctx, report.ID, "worker-2"); err != nil {
		t.Fatalf("duplicate render: %v", err)
	}
	got, err := a.services.Reporting.Get(ctx, report.ID)
	if err != nil {
		t.Fatalf("get report: %v", err)
	}
	if got.Status != reporting.StatusCompleted || got.OutputArtifactID == nil {
		t.Fatalf("report = %+v, want completed with output", got)
	}

	var artifacts int
	if err := a.pool.DB().QueryRow(ctx,
		"SELECT count(*) FROM artifacts WHERE run_id = $1 AND schema_version = 'report/default'", run.ID,
	).Scan(&artifacts); err != nil {
		t.Fatalf("count report artifacts: %v", err)
	}
	if artifacts != 1 {
		t.Fatalf("report artifacts = %d, want 1", artifacts)
	}

	_, rc, err := a.services.OpenAuthorizedReportContent(ctx, report.ID)
	if err != nil {
		t.Fatalf("open report content: %v", err)
	}
	defer rc.Close()
	buf := new(strings.Builder)
	if _, err := io.Copy(buf, rc); err != nil {
		t.Fatalf("read report content: %v", err)
	}
	if !strings.Contains(buf.String(), "phase8 run") || !strings.Contains(buf.String(), "Missing HSTS") {
		t.Fatalf("report content missing expected data:\n%s", buf.String())
	}

	// A later finding change must not alter the already published report.
	revised, err := a.services.Findings.ReviseFinding(ctx, findings.ReviseFindingParams{
		FindingID: finding.ID, ExpectedVersion: finding.Version, Title: "Missing HSTS (revised)",
		Description: "changed after the report snapshot", Severity: findings.SeverityHigh,
		Confidence: findings.ConfidenceHigh, Reason: "post-report change", Actor: "alice",
	})
	if err != nil {
		t.Fatalf("revise finding: %v", err)
	}
	if revised.Version != finding.Version+1 {
		t.Fatalf("revised version = %d, want %d", revised.Version, finding.Version+1)
	}
	if err := a.services.Reporting.Render(ctx, report.ID, "worker-3"); err != nil {
		t.Fatalf("re-render completed report: %v", err)
	}
	_, rc2, err := a.services.OpenAuthorizedReportContent(ctx, report.ID)
	if err != nil {
		t.Fatalf("reopen report content: %v", err)
	}
	defer rc2.Close()
	buf2 := new(strings.Builder)
	if _, err := io.Copy(buf2, rc2); err != nil {
		t.Fatalf("read report content again: %v", err)
	}
	if strings.Contains(buf2.String(), "revised") {
		t.Fatalf("report content changed after snapshot:\n%s", buf2.String())
	}
}

// TestPhase8FindingRevisionReview proves revisions are immutable, review is the
// only status owner, and verdicts bind to a specific revision.
func TestPhase8FindingRevisionReview(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase8App(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	slug := "phase8-review-" + uuid.NewString()[:8]
	_, run := phase8Base(t, a, ctx, slug, "alice", "bob")

	finding, err := a.services.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID: run.ID, Title: "Open redirect", Description: "unvalidated redirect",
		Severity: findings.SeverityLow, Confidence: findings.ConfidenceMedium, Actor: "alice",
	})
	if err != nil {
		t.Fatalf("create finding: %v", err)
	}

	// Two reviewers racing the same version: only one wins.
	_, err = a.services.Findings.ReviewFinding(ctx, findings.ReviewFindingParams{
		FindingID: finding.ID, ExpectedVersion: finding.Version, Status: findings.StatusReviewed,
		Reviewer: "alice", Reason: "first review",
	})
	if err != nil {
		t.Fatalf("first review: %v", err)
	}
	if _, err := a.services.Findings.ReviewFinding(ctx, findings.ReviewFindingParams{
		FindingID: finding.ID, ExpectedVersion: finding.Version, Status: findings.StatusConfirmed,
		Reviewer: "bob", Reason: "stale review",
	}); err == nil {
		t.Fatal("expected optimistic lock on stale review")
	}

	// Revise on the new version, then confirm.
	current, err := a.services.Findings.GetFinding(ctx, finding.ID)
	if err != nil {
		t.Fatalf("get finding: %v", err)
	}
	if _, err := a.services.Findings.ReviseFinding(ctx, findings.ReviseFindingParams{
		FindingID: finding.ID, ExpectedVersion: current.Version, Title: "Open redirect",
		Description: "confirmed via re-run", Severity: findings.SeverityMedium,
		Confidence: findings.ConfidenceHigh, Reason: "evidence improved", Actor: "alice",
	}); err != nil {
		t.Fatalf("revise finding: %v", err)
	}
	current, _ = a.services.Findings.GetFinding(ctx, finding.ID)
	reviewed, err := a.services.Findings.ReviewFinding(ctx, findings.ReviewFindingParams{
		FindingID: finding.ID, ExpectedVersion: current.Version, Status: findings.StatusConfirmed,
		Reviewer: "alice", Reason: "confirmed",
	})
	if err != nil {
		t.Fatalf("confirm finding: %v", err)
	}
	if reviewed.Status != findings.StatusConfirmed {
		t.Fatalf("status = %s, want confirmed", reviewed.Status)
	}

	revisions, err := a.services.Findings.ListRevisions(ctx, finding.ID)
	if err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	// create, first review, revise, confirm review
	if len(revisions) != 4 {
		t.Fatalf("revisions = %d, want 4", len(revisions))
	}

	// A verdict must bind to a real revision; a later revision keeps history.
	if _, err := a.services.Findings.RecordVerdict(ctx, findings.InsertVerdictParams{
		FindingID: finding.ID, RevisionNo: 2, Verdict: findings.VerdictConfirmed,
		Reason: "re-check passed", ProducedBy: "verifier",
	}); err != nil {
		t.Fatalf("record verdict: %v", err)
	}
	if _, err := a.services.Findings.RecordVerdict(ctx, findings.InsertVerdictParams{
		FindingID: finding.ID, RevisionNo: 99, Verdict: findings.VerdictConfirmed,
		Reason: "bogus", ProducedBy: "verifier",
	}); err == nil {
		t.Fatal("expected an error for a missing revision")
	}
}

// TestPhase8RiverReportWorker proves report creation enqueues a River job and
// that starting the worker renders exactly one output artifact.
func TestPhase8RiverReportWorker(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase8App(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	slug := "phase8-river-" + uuid.NewString()[:8]
	_, run := phase8Base(t, a, ctx, slug, "alice", "bob")
	if _, err := a.services.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID: run.ID, Title: "River finding", Description: "d", Severity: findings.SeverityLow,
		Confidence: findings.ConfidenceLow, Actor: "alice",
	}); err != nil {
		t.Fatalf("create finding: %v", err)
	}

	report, err := a.services.CreateAuthorizedReport(ctx, reportRequestParams{
		RunID: run.ID, TemplateID: "default", TemplateVersion: "1",
	})
	if err != nil {
		t.Fatalf("create report: %v", err)
	}

	var jobs int
	if err := a.pool.DB().QueryRow(ctx,
		"SELECT count(*) FROM river_job WHERE kind = 'report_render' AND args->>'reportRequestId' = $1", report.ID.String(),
	).Scan(&jobs); err != nil {
		t.Fatalf("count river jobs: %v", err)
	}
	if jobs != 1 {
		t.Fatalf("river jobs = %d, want 1", jobs)
	}

	if a.jobs == nil {
		t.Fatal("jobs client was not wired")
	}
	if err := a.jobs.Start(ctx); err != nil {
		t.Fatalf("start jobs: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		_ = a.jobs.Stop(stopCtx)
	})

	deadline := time.Now().Add(20 * time.Second)
	for {
		got, err := a.services.Reporting.Get(ctx, report.ID)
		if err != nil {
			t.Fatalf("get report: %v", err)
		}
		if got.Status == reporting.StatusCompleted {
			if got.OutputArtifactID == nil {
				t.Fatal("completed report has no output artifact")
			}
			break
		}
		if got.Status == reporting.StatusFailed {
			t.Fatalf("report failed: %s %s", got.FailureCode, got.FailureMessage)
		}
		if time.Now().After(deadline) {
			t.Fatalf("report did not complete, status = %s", got.Status)
		}
		time.Sleep(150 * time.Millisecond)
	}

	var artifacts int
	if err := a.pool.DB().QueryRow(ctx,
		"SELECT count(*) FROM artifacts WHERE run_id = $1 AND schema_version = 'report/default'", run.ID,
	).Scan(&artifacts); err != nil {
		t.Fatalf("count report artifacts: %v", err)
	}
	if artifacts != 1 {
		t.Fatalf("report artifacts = %d, want 1", artifacts)
	}
}

// TestPhase8HTTPReportFlow drives report creation and revision listing through
// the HTTP transport using the development principal.
func TestPhase8HTTPReportFlow(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase8App(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	slug := "phase8-http-" + uuid.NewString()[:8]
	_, run := phase8Base(t, a, ctx, slug, "alice", "bob")
	handler := a.srv.Handler

	finding, err := a.services.Findings.CreateFinding(ctx, findings.CreateFindingParams{
		RunID: run.ID, Title: "HTTP finding", Description: "d", Severity: findings.SeverityLow,
		Confidence: findings.ConfidenceLow, Actor: "alice",
	})
	if err != nil {
		t.Fatalf("create finding: %v", err)
	}

	// Create the report over HTTP.
	body := `{"templateId":"default","templateVersion":"1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/"+run.ID.String()+"/reports", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", "report-1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create report status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if created.ID == "" || created.Status != "queued" {
		t.Fatalf("created report = %+v", created)
	}

	// A retry with the same key must return the same single report.
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/runs/"+run.ID.String()+"/reports", strings.NewReader(body))
	req2.Header.Set("Idempotency-Key", "report-1")
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("idempotent report status = %d body=%s", rec2.Code, rec2.Body.String())
	}
	var again struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec2.Body.Bytes(), &again)
	if again.ID != created.ID {
		t.Fatalf("idempotent report id = %s, want %s", again.ID, created.ID)
	}

	// Revisions are readable over HTTP.
	req3 := httptest.NewRequest(http.MethodGet, "/api/v1/findings/"+finding.ID.String()+"/revisions", nil)
	rec3 := httptest.NewRecorder()
	handler.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("list revisions status = %d body=%s", rec3.Code, rec3.Body.String())
	}
	var revisions struct {
		Items []struct {
			RevisionNo int `json:"revisionNo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec3.Body.Bytes(), &revisions); err != nil {
		t.Fatalf("decode revisions: %v", err)
	}
	if len(revisions.Items) != 1 || revisions.Items[0].RevisionNo != 1 {
		t.Fatalf("revisions = %+v, want one revision 1", revisions.Items)
	}
}
