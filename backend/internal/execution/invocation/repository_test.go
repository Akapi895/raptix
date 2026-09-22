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

	// Result update advances the version.
	now := time.Now().UTC()
	updated, err := repo.UpdateResult(ctx, ResultUpdate{
		ID: inv.ID, Version: inv.Version, Status: StatusSucceeded,
		ResultExecution: "success", ResultParse: "not_attempted", FinishedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusSucceeded || updated.Version != 2 {
		t.Errorf("updated = %+v", updated)
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
