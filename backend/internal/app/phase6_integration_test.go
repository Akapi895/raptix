package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
)

// phase6App builds an App wired with a real lab endpoint and a Content root that
// declares the http_probe tool, mirroring the Phase 4/5 integration setup.
func phase6App(t *testing.T, dsn string) *App {
	t.Helper()
	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writeFixture(t, contentRoot, "tools/manifests/http_probe.yaml", httpProbeManifest)

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = dsn
	cfg.Execution.MaxInvocationsPerRun = 0 // unlimited; budget is covered by unit tests
	cfg.Execution.ReconcileStaleAfter = time.Minute

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	return a
}

// phase6Base creates a project, scope, member, run.start + http_probe grants and
// an authorized run in the running state, returning them for the test body.
func phase6Base(t *testing.T, a *App, ctx context.Context, slug, actor, grantor string) (projects.Scope, runs.Run) {
	t.Helper()
	proj, err := a.services.Projects.CreateProject(ctx, "Phase6", slug)
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

	// LIFO cleanup: invocations (scope RESTRICT) before the project cascade,
	// attempts before the run cascade removes them automatically.
	t.Cleanup(func() {
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM tool_invocations WHERE run_id = $1", run.ID)
		_, _ = a.pool.DB().Exec(context.Background(), "DELETE FROM projects WHERE slug = $1", slug)
	})
	return scope, run
}

// phase6Lab returns a deterministic lab server the http_probe capability can hit.
func phase6Lab(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("lab-ok"))
	}))
}

// TestPhase6ReconcileStale is opt-in (RAP_TEST_DATABASE_URL). It simulates a
// crash that leaves an invocation "running" with an old start time, then runs
// Services.Reconcile and asserts the invocation is marked unknown rather than
// reported succeeded or re-dispatched.
func TestPhase6ReconcileStale(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase6App(t, dsn)
	lab := phase6Lab(t)
	defer lab.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase6r-%d", time.Now().UnixNano())
	scope, run := phase6Base(t, a, ctx, slug, actor, grantor)

	inv, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "r-1",
	})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if inv.Status != invocation.StatusSucceeded {
		t.Fatalf("invocation status = %s, want succeeded", inv.Status)
	}

	// Simulate a crash mid-dispatch: the row is left running with an old start.
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE tool_invocations SET status='running', started_at=now() - interval '10 minutes',
		 finished_at=NULL, result_execution='not_attempted', result_parse='not_attempted',
		 error_code='', error_message='' WHERE id=$1`, inv.ID); err != nil {
		t.Fatalf("simulate crash: %v", err)
	}
	before, err := a.services.Execution.Get(ctx, inv.ID)
	if err != nil {
		t.Fatalf("read-back: %v", err)
	}
	if before.Status != invocation.StatusRunning {
		t.Fatalf("before reconcile status = %s, want running", before.Status)
	}

	report, err := a.services.Reconcile(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if report.Reconciled < 1 {
		t.Fatalf("reconcile report = %+v, want >= 1 reconciled", report)
	}

	stored, err := a.services.Execution.Get(ctx, inv.ID)
	if err != nil {
		t.Fatalf("stored invocation: %v", err)
	}
	if stored.Status != invocation.StatusUnknown {
		t.Fatalf("stored status = %s, want unknown (must not stay succeeded/running)", stored.Status)
	}

	// Reconcile is idempotent: nothing more is reconciled.
	again, err := a.services.Reconcile(ctx)
	if err != nil {
		t.Fatalf("second reconcile: %v", err)
	}
	if got := again.Reconciled + again.Skipped; got != 0 {
		t.Fatalf("second reconcile report = %+v, want no work", again)
	}
}

// TestPhase6CancelRunCascade is opt-in (RAP_TEST_DATABASE_URL). It cancels a run
// with a task, agent, running attempt, a running invocation and a pending
// invocation, and asserts each module transitioned the state it owns: run/task/
// agent -> cancelled, attempt -> cancelled, running invocation -> unknown,
// pending invocation -> cancelled.
func TestPhase6CancelRunCascade(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase6App(t, dsn)
	lab := phase6Lab(t)
	defer lab.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase6c-%d", time.Now().UnixNano())
	scope, run := phase6Base(t, a, ctx, slug, actor, grantor)

	task, err := a.services.Runs.CreateTask(ctx, run.ID, "probe", runs.TaskQueued)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	agent, err := a.services.Runs.CreateAgent(ctx, run.ID, &task.ID, "recon-agent")
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	// A running attempt (engine/agents owns it) via the running default status.
	var attemptID uuid.UUID
	if err := a.pool.DB().QueryRow(ctx,
		`INSERT INTO agent_attempts (agent_id, attempt_no) VALUES ($1, 1) RETURNING id`, agent.ID).Scan(&attemptID); err != nil {
		t.Fatalf("insert running attempt: %v", err)
	}

	// A running invocation -> must become unknown on cancel.
	runInv, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "c-running",
	})
	if err != nil {
		t.Fatalf("invoke running: %v", err)
	}
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE tool_invocations SET status='running', started_at=now() - interval '2 minutes',
		 finished_at=NULL, result_execution='not_attempted', result_parse='not_attempted',
		 error_code='', error_message='' WHERE id=$1`, runInv.ID); err != nil {
		t.Fatalf("simulate running invocation: %v", err)
	}

	// A pending invocation -> must become cancelled on cancel (no side effect).
	pendInv, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "c-pending",
	})
	if err != nil {
		t.Fatalf("invoke pending: %v", err)
	}
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE tool_invocations SET status='pending', started_at=NULL, finished_at=NULL,
		 result_execution='not_attempted', result_parse='not_attempted', error_code='', error_message='' WHERE id=$1`, pendInv.ID); err != nil {
		t.Fatalf("simulate pending invocation: %v", err)
	}

	res, err := a.services.CancelRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	if res.TasksCancelled != 1 || res.AgentsCancelled != 1 || res.AttemptsCancelled != 1 {
		t.Errorf("cancel result = %+v", res)
	}
	if res.InvsCancelled != 1 || res.InvsUnknown != 1 {
		t.Errorf("cancel invocations = cancelled:%d unknown:%d, want 1/1", res.InvsCancelled, res.InvsUnknown)
	}

	if got, _ := a.services.Runs.GetRun(ctx, run.ID); got.Status != runs.RunCancelled {
		t.Errorf("run status = %s, want cancelled", got.Status)
	}
	if got, _ := a.services.Runs.GetTask(ctx, task.ID); got.Status != runs.TaskCancelled {
		t.Errorf("task status = %s, want cancelled", got.Status)
	}
	if got, _ := a.services.Runs.GetAgent(ctx, agent.ID); got.Status != runs.AgentCancelled {
		t.Errorf("agent status = %s, want cancelled", got.Status)
	}
	attempts, err := a.services.Agents.ListAttempts(ctx, agent.ID)
	if err != nil || len(attempts) == 0 || attempts[0].Status != agents.AttemptCancelled {
		t.Errorf("attempts = %+v err=%v, want one cancelled attempt", attempts, err)
	}
	if got, _ := a.services.Execution.Get(ctx, runInv.ID); got.Status != invocation.StatusUnknown {
		t.Errorf("running invocation status = %s, want unknown (side effect unrecorded)", got.Status)
	}
	if got, _ := a.services.Execution.Get(ctx, pendInv.ID); got.Status != invocation.StatusCancelled {
		t.Errorf("pending invocation status = %s, want cancelled", got.Status)
	}

	var auditN int
	if err := a.pool.DB().QueryRow(ctx,
		`SELECT count(*) FROM audit_records WHERE action='run.cancel' AND correlation=$1`, run.ID.String()).Scan(&auditN); err != nil {
		t.Fatalf("count run.cancel audits: %v", err)
	}
	if auditN < 1 {
		t.Fatalf("run.cancel audit records = %d, want >= 1", auditN)
	}
}

// TestPhase6CancelDoesNotMissConcurrentInvocationCreation holds the run row
// while a pending invocation is inserted, then starts cancellation. The shared
// lock makes CancelRun wait for the insert transaction; after commit its sweep
// must see and cancel that row, so the stale pending version can never start a
// tool after the run has been cancelled.
func TestPhase6CancelDoesNotMissConcurrentInvocationCreation(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase6App(t, dsn)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase6lock-%d", time.Now().UnixNano())
	scope, run := phase6Base(t, a, ctx, slug, actor, grantor)

	var created invocation.Invocation
	cancelDone := make(chan error, 1)
	if err := a.pool.TxFunc(ctx, func(txCtx context.Context, tx pgx.Tx) error {
		var err error
		created, err = invocation.NewPostgres(tx).CreateInvocation(txCtx, invocation.CreateParams{
			RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe", IdempotencyKey: "lock-1",
			Request: json.RawMessage(`{"url":"http://example.invalid"}`),
		})
		if err != nil {
			return err
		}
		go func() {
			_, err := a.services.CancelRun(ctx, run.ID)
			cancelDone <- err
		}()
		select {
		case err := <-cancelDone:
			return fmt.Errorf("CancelRun completed while CreateInvocation held the run lock: %v", err)
		case <-time.After(50 * time.Millisecond):
			return nil
		}
	}); err != nil {
		t.Fatalf("create under run lock: %v", err)
	}
	if err := <-cancelDone; err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	stored, err := a.services.Execution.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("read invocation: %v", err)
	}
	if stored.Status != invocation.StatusCancelled {
		t.Fatalf("invocation status = %s, want cancelled", stored.Status)
	}
	if _, err := invocation.NewPostgres(a.pool.DB()).StartInvocation(ctx, created.ID, created.Version); err == nil {
		t.Fatal("cancelled invocation must not start after cancellation")
	}
}

// TestPhase6ResultCannotBeRecordedAfterRunCancelled simulates a tool whose side
// effect happened while its run became terminal. Even if the invocation is still
// marked running, its result must not be recorded as succeeded after the run
// row is cancelled; the guard turns the update into an optimistic conflict so
// the invocation is reconciled to unknown rather than reported succeeded.
func TestPhase6ResultCannotBeRecordedAfterRunCancelled(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase6App(t, dsn)
	lab := phase6Lab(t)
	defer lab.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase6res-%d", time.Now().UnixNano())
	scope, run := phase6Base(t, a, ctx, slug, actor, grantor)

	inv, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "res-1",
	})
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}

	// Reopen the invocation as running (its tool is in flight).
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE tool_invocations SET status='running', started_at=now() - interval '1 minute',
		 finished_at=NULL, result_execution='not_attempted', result_parse='not_attempted',
		 error_code='', error_message='' WHERE id=$1`, inv.ID); err != nil {
		t.Fatalf("reopen invocation: %v", err)
	}

	// Cancel only the run row, leaving the invocation sweep aside, to isolate
	// the result-guard from the sweep.
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE runs SET status='cancelled', version=version+1, updated_at=now() WHERE id=$1`, run.ID); err != nil {
		t.Fatalf("cancel run: %v", err)
	}

	_, err = invocation.NewPostgres(a.pool.DB()).UpdateResult(ctx, invocation.ResultUpdate{
		ID: inv.ID, Version: inv.Version, Status: invocation.StatusSucceeded,
		ResultExecution: "success", ResultParse: "not_attempted", FinishedAt: time.Now().UTC(),
	})
	var lock *invocation.ErrOptimisticLock
	if !errors.As(err, &lock) {
		t.Fatalf("UpdateResult err = %v, want ErrOptimisticLock after run cancelled", err)
	}

	stored, err := a.services.Execution.Get(ctx, inv.ID)
	if err != nil {
		t.Fatalf("read invocation: %v", err)
	}
	if stored.Status == invocation.StatusSucceeded {
		t.Fatal("invocation must not become succeeded after the run was cancelled")
	}
}

// TestPhase6IdempotencyNoRerun is opt-in (RAP_TEST_DATABASE_URL). With a prior
// invocation for the same key left in the unknown state (result not recorded), a
// retry must not dispatch a new invocation: it surfaces the unknown outcome and
// leaves the run's invocation set unchanged.
func TestPhase6IdempotencyNoRerun(t *testing.T) {
	dsn := requireTestDSN(t)
	a := phase6App(t, dsn)
	lab := phase6Lab(t)
	defer lab.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actor, grantor := "alice", "bob"
	slug := fmt.Sprintf("phase6i-%d", time.Now().UnixNano())
	scope, run := phase6Base(t, a, ctx, slug, actor, grantor)

	inv, _, err := a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "idem-1",
	})
	if err != nil {
		t.Fatalf("first invoke: %v", err)
	}
	// Left unknown by a reconcile (or crash): the external effect may have
	// happened but is not recorded.
	if _, err := a.pool.DB().Exec(ctx,
		`UPDATE tool_invocations SET status='unknown', finished_at=now() WHERE id=$1`, inv.ID); err != nil {
		t.Fatalf("simulate unknown invocation: %v", err)
	}

	_, _, err = a.services.InvokeCapability(ctx, invocation.InvokeParams{
		RunID: run.ID, ScopeID: scope.ID, Actor: actor, Capability: "http_probe",
		Args: json.RawMessage(fmt.Sprintf(`{"url":%q}`, lab.URL)), IdempotencyKey: "idem-1",
	})
	var unknown *invocation.ErrOutcomeUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("second invoke err = %v, want ErrOutcomeUnknown", err)
	}
	if unknown.ID != inv.ID {
		t.Fatalf("unknown invocation id = %s, want %s", unknown.ID, inv.ID)
	}

	invs, err := a.services.Execution.ListByRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("list invocations: %v", err)
	}
	if len(invs) != 1 {
		t.Fatalf("invocations = %d, want 1 (no re-dispatch on unknown)", len(invs))
	}
	if invs[0].Status != invocation.StatusUnknown {
		t.Fatalf("invocation status = %s, want unknown (must not be reported succeeded)", invs[0].Status)
	}
}
