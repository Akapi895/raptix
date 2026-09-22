package cancel

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
)

type fakeStore struct {
	byRun            map[uuid.UUID][]invocation.Invocation
	stale            []invocation.Invocation
	markUnknownCalls []int
	cancelCalls      []string
	err              error
}

func newFakeStore() *fakeStore {
	return &fakeStore{byRun: map[uuid.UUID][]invocation.Invocation{}}
}

func (f *fakeStore) add(runID uuid.UUID, inv invocation.Invocation) {
	f.byRun[runID] = append(f.byRun[runID], inv)
}

func (f *fakeStore) ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]invocation.Invocation, error) {
	return append([]invocation.Invocation{}, f.stale...), f.err
}

func (f *fakeStore) MarkUnknown(ctx context.Context, id uuid.UUID, version int) (invocation.Invocation, error) {
	f.markUnknownCalls = append(f.markUnknownCalls, version)
	switch version {
	case 99:
		return invocation.Invocation{}, &invocation.ErrOptimisticLock{ID: id}
	case 98:
		return invocation.Invocation{}, errors.New("boom")
	default:
		for i, inv := range f.stale {
			if inv.ID == id {
				f.stale = append(f.stale[:i], f.stale[i+1:]...)
				break
			}
		}
		return invocation.Invocation{ID: id, Status: invocation.StatusUnknown, Version: version + 1}, nil
	}
}

func (f *fakeStore) CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []invocation.Status, to invocation.Status) (int64, error) {
	f.cancelCalls = append(f.cancelCalls, string(to))
	var n int64
	list := f.byRun[runID]
	in := map[invocation.Status]bool{}
	for _, s := range from {
		in[s] = true
	}
	for i, inv := range list {
		if in[inv.Status] {
			n++
			list[i].Status = to
		}
	}
	f.byRun[runID] = list
	return n, nil
}

func TestCancelRunMapsPendingAndRunning(t *testing.T) {
	f := newFakeStore()
	runID := uuid.New()
	f.add(runID, invocation.Invocation{ID: uuid.New(), RunID: runID, Status: invocation.StatusPending})
	f.add(runID, invocation.Invocation{ID: uuid.New(), RunID: runID, Status: invocation.StatusDispatched})
	f.add(runID, invocation.Invocation{ID: uuid.New(), RunID: runID, Status: invocation.StatusRunning})
	// Terminal states are untouched by CancelRun.
	f.add(runID, invocation.Invocation{ID: uuid.New(), RunID: runID, Status: invocation.StatusSucceeded})

	svc := NewService(f, nil)
	report, err := svc.CancelRun(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	if report.Cancelled != 2 {
		t.Errorf("cancelled = %d, want 2", report.Cancelled)
	}
	if report.Unknown != 1 {
		t.Errorf("unknown = %d, want 1", report.Unknown)
	}
}

func TestReconcileMarksStaleAndSkipsConflicts(t *testing.T) {
	f := newFakeStore()
	runID := uuid.New()
	// One reconcilable, one that optimistically conflicts (version 99), one that
	// fails with a non-lock error (version 98).
	f.stale = []invocation.Invocation{
		{ID: uuid.New(), RunID: runID, Status: invocation.StatusPending, Version: 1},
		{ID: uuid.New(), RunID: runID, Status: invocation.StatusRunning, Version: 99},
		{ID: uuid.New(), RunID: runID, Status: invocation.StatusRunning, Version: 98},
	}

	report, err := NewService(f, nil).Reconcile(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if report.Reconciled != 1 {
		t.Errorf("reconciled = %d, want 1", report.Reconciled)
	}
	if report.Skipped != 1 {
		t.Errorf("skipped = %d, want 1", report.Skipped)
	}
	if len(report.Errors) != 1 {
		t.Errorf("errors = %v, want 1", report.Errors)
	}
}

func TestReconcileRejectsNonPositiveThreshold(t *testing.T) {
	if _, err := NewService(newFakeStore(), nil).Reconcile(context.Background(), 0); err == nil {
		t.Error("expected error for non-positive threshold")
	}
}

func TestReconcileIdempotentAfterMark(t *testing.T) {
	f := newFakeStore()
	f.stale = []invocation.Invocation{{ID: uuid.New(), Status: invocation.StatusRunning, Version: 1}}
	svc := NewService(f, nil)
	report, err := svc.Reconcile(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if report.Reconciled != 1 {
		t.Errorf("first reconciled = %d, want 1", report.Reconciled)
	}
	report, err = svc.Reconcile(context.Background(), 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if report.Reconciled != 0 || report.Skipped != 0 {
		t.Errorf("second report = %+v, want no work", report)
	}
}
