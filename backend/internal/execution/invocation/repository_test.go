package invocation

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCreateGetAndIdempotencyKey(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	runID := uuid.New()
	scopeID := uuid.New()

	inv, err := repo.CreateInvocation(ctx, CreateParams{
		RunID: runID, ScopeID: scopeID, Actor: "alice", Capability: "http_probe",
		IdempotencyKey: "k1", Request: json.RawMessage(`{"url":"https://x"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if inv.Status != StatusPending || inv.Version != 1 {
		t.Errorf("inv = %+v", inv)
	}

	// Same (run, key) returns the same invocation; the fake rejects a duplicate.
	dup, err := repo.GetByRunAndIdempotencyKey(ctx, runID, "k1")
	if err != nil {
		t.Fatal(err)
	}
	if dup.ID != inv.ID {
		t.Errorf("dup id = %v, want %v", dup.ID, inv.ID)
	}

	// Dispatch moves pending to running before a result can be recorded.
	running, err := repo.StartInvocation(ctx, inv.ID, inv.Version)
	if err != nil {
		t.Fatal(err)
	}

	// Result update advances the version.
	now := time.Now().UTC()
	updated, err := repo.UpdateResult(ctx, ResultUpdate{
		ID: inv.ID, Version: running.Version, Status: StatusSucceeded,
		ResultExecution: "success", ResultParse: "not_attempted", FinishedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusSucceeded || updated.Version != 3 {
		t.Errorf("updated = %+v", updated)
	}
	// Transitions require both the expected version and their legal source state.
	if _, err := repo.StartInvocation(ctx, updated.ID, updated.Version); err == nil {
		t.Error("expected terminal invocation not to restart")
	}

	// Stale version yields ErrOptimisticLock.
	if _, err := repo.UpdateResult(ctx, ResultUpdate{ID: inv.ID, Version: 1, Status: StatusFailed, FinishedAt: now}); err == nil {
		t.Error("expected optimistic-lock error on stale version")
	} else {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			t.Errorf("err = %v, want ErrOptimisticLock", err)
		}
	}
}

func TestCountListByRun(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	runID := uuid.New()
	for i := 0; i < 3; i++ {
		if _, err := repo.CreateInvocation(ctx, CreateParams{
			RunID: runID, ScopeID: uuid.New(), Actor: "a", Capability: "http_probe",
			IdempotencyKey: "k" + string(rune('0'+i)), Request: json.RawMessage(`{}`),
		}); err != nil {
			t.Fatal(err)
		}
	}
	n, err := repo.CountByRun(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("count = %d, want 3", n)
	}
	list, err := repo.ListByRun(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Errorf("list len = %d, want 3", len(list))
	}
}

func TestStartInvocationMarksRunningWithStartedAt(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	inv, err := repo.CreateInvocation(ctx, CreateParams{RunID: uuid.New(), ScopeID: uuid.New(), Actor: "a", Capability: "http_probe", IdempotencyKey: "k"})
	if err != nil {
		t.Fatal(err)
	}
	started, err := repo.StartInvocation(ctx, inv.ID, inv.Version)
	if err != nil {
		t.Fatal(err)
	}
	if started.Status != StatusRunning || started.StartedAt == nil {
		t.Fatalf("started = %+v", started)
	}
	if started.Version != inv.Version+1 {
		t.Errorf("version = %d, want %d", started.Version, inv.Version+1)
	}
	// Stale version yields an optimistic-lock error.
	if _, err := repo.StartInvocation(ctx, inv.ID, inv.Version); err == nil {
		t.Error("expected optimistic-lock on stale start")
	} else {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			t.Errorf("err = %v, want ErrOptimisticLock", err)
		}
	}
}

func TestMarkUnknownAndListStale(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	runID := uuid.New()
	a, _ := repo.CreateInvocation(ctx, CreateParams{RunID: runID, ScopeID: uuid.New(), Actor: "a", Capability: "http_probe", IdempotencyKey: "new"})
	b, _ := repo.CreateInvocation(ctx, CreateParams{RunID: runID, ScopeID: uuid.New(), Actor: "a", Capability: "http_probe", IdempotencyKey: "old"})
	// Mark b running (started_at set by StartInvocation).
	if _, err := repo.StartInvocation(ctx, b.ID, b.Version); err != nil {
		t.Fatal(err)
	}

	// Only invocations older than the threshold are stale.
	recent := time.Now().UTC().Add(10 * time.Second)
	stale, err := repo.ListStaleInvocations(ctx, recent)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 2 {
		t.Fatalf("stale = %d, want 2", len(stale))
	}

	if n, err := repo.CancelInvocationsByRun(ctx, runID, []Status{StatusPending}, StatusCancelled); err != nil || n != 1 {
		t.Fatalf("cancel pending = %d err=%v, want 1", n, err)
	}
	// 'a' is now cancelled, so it is no longer stale.
	stale, _ = repo.ListStaleInvocations(ctx, recent)
	if len(stale) != 1 || stale[0].ID != b.ID {
		t.Fatalf("stale = %+v, want only b", stale)
	}

	cancelled, err := repo.GetInvocation(ctx, a.ID)
	if err != nil || cancelled.Status != StatusCancelled {
		t.Fatalf("a = %+v err=%v, want cancelled", cancelled, err)
	}

	unknown, err := repo.MarkUnknown(ctx, b.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.Status != StatusUnknown || unknown.Version != 3 {
		t.Fatalf("unknown = %+v", unknown)
	}
	// A stale version is rejected rather than overriding the terminal state.
	if _, err := repo.MarkUnknown(ctx, b.ID, 1); err == nil {
		t.Error("expected optimistic-lock on stale MarkUnknown")
	}
	if _, err := repo.MarkUnknown(ctx, b.ID, unknown.Version); err == nil {
		t.Error("expected terminal invocation not to become unknown again")
	}
}
