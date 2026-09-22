package invocation

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/tools/registry"
	"github.com/google/uuid"
)

type fakeGrants struct {
	ok  bool
	err error
}

func (f *fakeGrants) CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error) {
	return f.ok, f.err
}

type fakeScopes struct {
	active bool
	err    error
}

func (f *fakeScopes) IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error) {
	return f.active, f.err
}

type fakeRuns struct {
	run runs.Run
	err error
}

func (f *fakeRuns) GetRun(ctx context.Context, id uuid.UUID) (runs.Run, error) {
	return f.run, f.err
}

type fakeAudit struct{}

func (f *fakeAudit) Record(ctx context.Context, rec audit.Record) (audit.AuditRecord, error) {
	return audit.AuditRecord{}, nil
}

type fakeImpl struct {
	res   *output.Result
	err   error
	calls int
	raw   json.RawMessage
}

func (f *fakeImpl) Invoke(ctx context.Context, args json.RawMessage) (*output.Result, error) {
	f.calls++
	f.raw = args
	return f.res, f.err
}

type harness struct {
	svc      *Service
	repo     *memRepo
	impl     *fakeImpl
	grants   *fakeGrants
	scopes   *fakeScopes
	run      *fakeRuns
	registry *registry.Registry
}

func newHarness() *harness {
	timeout := 5 * time.Second
	reg := registry.New()
	impl := &fakeImpl{}
	_ = reg.Register("http_probe", "1.0.0", content.ExecutorBuiltin, impl, "builtin/http_probe.go")
	repo := newMemRepo()
	grants := &fakeGrants{ok: true}
	scopes := &fakeScopes{active: true}
	run := &fakeRuns{run: runs.Run{ID: uuid.New(), Status: runs.RunRunning}}
	svc := NewService(repo, Config{
		DefaultTimeout: timeout, MaxOutputBytes: 1 << 20, MaxInvocationsPerRun: 10,
	}, grants, scopes, run, &fakeAudit{}, reg, nil)
	return &harness{svc: svc, repo: repo, impl: impl, grants: grants, scopes: scopes, run: run, registry: reg}
}

func (h *harness) params() InvokeParams {
	return InvokeParams{
		RunID: h.run.run.ID, ScopeID: uuid.New(), Actor: "alice",
		Capability: "http_probe", Args: json.RawMessage(`{}`), IdempotencyKey: "k",
	}
}

func TestInvokeDeniedWithoutGrant(t *testing.T) {
	h := newHarness()
	h.grants.ok = false
	inv, res, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusDenied {
		t.Errorf("status = %s, want denied", inv.Status)
	}
	if res.Execution != output.ExecutionDenied {
		t.Errorf("res.execution = %s, want denied", res.Execution)
	}
	if h.impl.calls != 0 {
		t.Error("implementation must not run when denied")
	}
}

func TestInvokeDeniedWhenScopeInactive(t *testing.T) {
	h := newHarness()
	h.scopes.active = false
	inv, _, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusDenied {
		t.Errorf("status = %s, want denied", inv.Status)
	}
}

func TestInvokeDeniedWhenRunCancelled(t *testing.T) {
	h := newHarness()
	h.run.run.Status = runs.RunCancelled
	inv, _, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusDenied {
		t.Errorf("status = %s, want denied", inv.Status)
	}
}

func TestInvokeDeniedWhenCapabilityUnbound(t *testing.T) {
	h := newHarness()
	reg := registry.New() // empty registry
	h.svc.resolver = reg
	inv, res, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusDenied || res.Execution != output.ExecutionDenied {
		t.Errorf("inv=%s res=%s, want denied", inv.Status, res.Execution)
	}
}

func TestInvokeDeniedWhenBudgetExhausted(t *testing.T) {
	h := newHarness()
	h.svc.cfg.MaxInvocationsPerRun = 1
	h.impl.res = output.Success(uuid.NewString(), "", "")
	// First succeeds and consumes the single budget slot.
	if _, _, err := h.svc.Invoke(context.Background(), h.params()); err != nil {
		t.Fatal(err)
	}
	// Second (distinct idempotency key) is denied by budget.
	p := h.params()
	p.IdempotencyKey = "other-key"
	inv, _, _ := h.svc.Invoke(context.Background(), p)
	if inv.Status != StatusDenied {
		t.Errorf("status = %s, want denied on budget exhaustion", inv.Status)
	}
}

func TestInvokeSuccessUpdatesResultAndRef(t *testing.T) {
	h := newHarness()
	artID := uuid.New()
	h.impl.res = output.Success(artID.String(), "", "")
	inv, res, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusSucceeded {
		t.Errorf("status = %s, want succeeded", inv.Status)
	}
	if res.Execution != output.ExecutionSuccess {
		t.Errorf("res = %+v", res)
	}
	if inv.RawArtifactID == nil || *inv.RawArtifactID != artID {
		t.Errorf("raw artifact = %v, want %v", inv.RawArtifactID, artID)
	}
	if h.impl.calls != 1 {
		t.Errorf("impl calls = %d, want 1", h.impl.calls)
	}
}

func TestInvokeFailedMapsToFailed(t *testing.T) {
	h := newHarness()
	h.impl.res = output.Error("", context.DeadlineExceeded)
	inv, _, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusFailed {
		t.Errorf("status = %s, want failed", inv.Status)
	}
	if inv.ErrorCode == "" || inv.ErrorMessage == "" {
		t.Errorf("expected error fields: %+v", inv)
	}
}

func TestInvokeIdempotent(t *testing.T) {
	h := newHarness()
	h.impl.res = output.Success(uuid.NewString(), "", "")
	if _, _, err := h.svc.Invoke(context.Background(), h.params()); err != nil {
		t.Fatal(err)
	}
	h.impl.calls = 0
	// Same idempotency key returns the prior invocation without re-dispatching.
	second, res, err := h.svc.Invoke(context.Background(), h.params())
	if err != nil {
		t.Fatal(err)
	}
	if h.impl.calls != 0 {
		t.Error("idempotent retry must not re-dispatch")
	}
	if second.Status != StatusSucceeded {
		t.Errorf("status = %s, want succeeded", second.Status)
	}
	_ = res
}

func TestInvokeIdempotencySurfacesUnknownOutcome(t *testing.T) {
	h := newHarness()
	ctx := context.Background()
	p := h.params()
	// A prior invocation exists for the same (run, key) and is in flight (running).
	inv, err := h.repo.CreateInvocation(ctx, CreateParams{
		RunID: p.RunID, ScopeID: p.ScopeID, Actor: p.Actor, Capability: p.Capability,
		IdempotencyKey: p.IdempotencyKey, Request: p.Args,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.repo.StartInvocation(ctx, inv.ID, inv.Version); err != nil {
		t.Fatal(err)
	}

	_, res, err := h.svc.Invoke(ctx, p)
	var unknown *ErrOutcomeUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("err = %v, want ErrOutcomeUnknown", err)
	}
	if res != nil {
		t.Error("unknown outcome must produce a nil result (no dispatch)")
	}
	if h.impl.calls != 0 {
		t.Error("unknown outcome must not trigger a re-dispatch")
	}
}

func TestInvokeIdempotencySurfacesAllUnresolvedStates(t *testing.T) {
	for _, status := range []Status{StatusPending, StatusDispatched, StatusRunning, StatusUnknown} {
		t.Run(string(status), func(t *testing.T) {
			h := newHarness()
			ctx := context.Background()
			p := h.params()
			inv, err := h.repo.CreateInvocation(ctx, CreateParams{
				RunID: p.RunID, ScopeID: p.ScopeID, Actor: p.Actor, Capability: p.Capability,
				IdempotencyKey: p.IdempotencyKey, Request: p.Args,
			})
			if err != nil {
				t.Fatal(err)
			}
			if status == StatusRunning {
				inv, err = h.repo.StartInvocation(ctx, inv.ID, inv.Version)
				if err != nil {
					t.Fatal(err)
				}
			}
			if status != StatusPending && status != StatusRunning {
				inv.Status = status
				h.repo.invocations[inv.ID] = inv
			}

			_, _, err = h.svc.Invoke(ctx, p)
			var unknown *ErrOutcomeUnknown
			if !errors.As(err, &unknown) || unknown.Status != status {
				t.Fatalf("err = %v, want ErrOutcomeUnknown for %s", err, status)
			}
			if h.impl.calls != 0 {
				t.Fatalf("%s idempotency hit must not dispatch", status)
			}
		})
	}
}

func TestInvokeConcurrentIdempotencyConflictReturnsStoredOutcome(t *testing.T) {
	h := newHarness()
	ctx := context.Background()
	p := h.params()
	inv, err := h.repo.CreateInvocation(ctx, CreateParams{
		RunID: p.RunID, ScopeID: p.ScopeID, Actor: p.Actor, Capability: p.Capability,
		IdempotencyKey: p.IdempotencyKey, Request: p.Args,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.repo.StartInvocation(ctx, inv.ID, inv.Version); err != nil {
		t.Fatal(err)
	}
	// Simulate two first callers observing no row, with the other caller winning
	// the insert immediately before this caller attempts its own insert.
	h.repo.hideLookupOnce = true
	_, _, err = h.svc.Invoke(ctx, p)
	var unknown *ErrOutcomeUnknown
	if !errors.As(err, &unknown) || unknown.ID != inv.ID {
		t.Fatalf("err = %v, want stored ErrOutcomeUnknown", err)
	}
	if h.impl.calls != 0 {
		t.Error("concurrent idempotency conflict must not dispatch")
	}
}
