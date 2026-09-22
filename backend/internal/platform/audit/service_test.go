package audit

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
type memRepo struct {
	records       map[uuid.UUID]AuditRecord
	byActor       map[string][]AuditRecord
	byCorrelation map[string][]AuditRecord
	next          int
}

func newMemRepo() *memRepo {
	return &memRepo{
		records:       map[uuid.UUID]AuditRecord{},
		byActor:       map[string][]AuditRecord{},
		byCorrelation: map[string][]AuditRecord{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("audit-"+strconv.Itoa(m.next)))
}

func (m *memRepo) Insert(ctx context.Context, r Record) (AuditRecord, error) {
	id := m.newID()
	ar := AuditRecord{
		ID: id, Actor: r.Actor, Action: r.Action, Resource: r.Resource,
		Outcome: r.Outcome, Reason: r.Reason, Correlation: r.Correlation,
		CreatedAt: time.Now().UTC(),
	}
	m.records[id] = ar
	m.byActor[r.Actor] = append(m.byActor[r.Actor], ar)
	m.byCorrelation[r.Correlation] = append(m.byCorrelation[r.Correlation], ar)
	return ar, nil
}

func (m *memRepo) GetByID(ctx context.Context, id uuid.UUID) (AuditRecord, error) {
	ar, ok := m.records[id]
	if !ok {
		return AuditRecord{}, &ErrNotFound{ID: id}
	}
	return ar, nil
}

func (m *memRepo) ListByActor(ctx context.Context, actor string) ([]AuditRecord, error) {
	return append([]AuditRecord(nil), m.byActor[actor]...), nil
}

func (m *memRepo) ListByCorrelation(ctx context.Context, correlation string) ([]AuditRecord, error) {
	return append([]AuditRecord(nil), m.byCorrelation[correlation]...), nil
}

func TestRecordPersists(t *testing.T) {
	repo := newMemRepo()
	svc := NewService(repo)
	ctx := context.Background()

	ar, err := svc.Record(ctx, Record{
		Actor: "agent-alice", Action: "run.create", Resource: "run/1",
		Outcome: OutcomeAllowed, Reason: "within scope", Correlation: "corr-1",
	})
	if err != nil {
		t.Fatalf("record: %v", err)
	}
	if ar.Actor != "agent-alice" || ar.Action != "run.create" || ar.Outcome != OutcomeAllowed {
		t.Errorf("record = %+v", ar)
	}
	if ar.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}

	got, err := repo.GetByID(ctx, ar.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != ar {
		t.Errorf("get = %+v, want %+v", got, ar)
	}

	list, err := repo.ListByCorrelation(ctx, "corr-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != ar.ID {
		t.Errorf("list = %+v", list)
	}
}

func TestRecordRejectsEmptyActor(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.Record(ctx, Record{Action: "run.create", Outcome: OutcomeAllowed}); err == nil {
		t.Error("expected empty-actor error")
	}
}

func TestRecordRejectsEmptyAction(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.Record(ctx, Record{Actor: "alice", Outcome: OutcomeAllowed}); err == nil {
		t.Error("expected empty-action error")
	}
}

func TestRecordRejectsEmptyOutcome(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.Record(ctx, Record{Actor: "alice", Action: "run.create"}); err == nil {
		t.Error("expected empty-outcome error")
	}
}

func TestRecordDistinctIDsAndInvalidOutcome(t *testing.T) {
	repo := newMemRepo()
	svc := NewService(repo)
	ctx := context.Background()
	a, err := svc.Record(ctx, Record{Actor: "alice", Action: "run.start", Outcome: OutcomeAllowed})
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.Record(ctx, Record{Actor: "alice", Action: "run.start", Outcome: OutcomeDenied})
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID {
		t.Fatal("two audit records must have distinct ids")
	}
	if _, err := repo.GetByID(ctx, b.ID); err != nil {
		t.Fatalf("second record not retrievable by its own id: %v", err)
	}
	if _, err := svc.Record(ctx, Record{Actor: "alice", Action: "run.start", Outcome: Outcome("bogus")}); err == nil {
		t.Error("expected invalid-outcome error")
	}
}
