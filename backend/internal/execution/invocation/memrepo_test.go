package invocation

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
// It mirrors production semantics: idempotency by (run, key) and optimistic
// version on result updates.
type memRepo struct {
	invocations    map[uuid.UUID]Invocation
	byKey          map[string]uuid.UUID
	hideLookupOnce bool
	next           int
}

func newMemRepo() *memRepo {
	return &memRepo{
		invocations: map[uuid.UUID]Invocation{},
		byKey:       map[string]uuid.UUID{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("invocation-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateInvocation(ctx context.Context, p CreateParams) (Invocation, error) {
	key := p.RunID.String() + ":" + p.IdempotencyKey
	if id, ok := m.byKey[key]; ok {
		return m.invocations[id], &ErrIdempotencyConflict{RunID: p.RunID, Key: p.IdempotencyKey}
	}
	id := m.newID()
	inv := Invocation{
		ID: id, RunID: p.RunID, TaskID: p.TaskID, ScopeID: p.ScopeID,
		Actor: p.Actor, Capability: p.Capability, CapabilityVersion: p.CapabilityVersion,
		Status: StatusPending, Request: p.Request, IdempotencyKey: p.IdempotencyKey,
		Version: 1,
	}
	m.invocations[id] = inv
	m.byKey[key] = id
	return inv, nil
}

func (m *memRepo) GetInvocation(ctx context.Context, id uuid.UUID) (Invocation, error) {
	inv, ok := m.invocations[id]
	if !ok {
		return Invocation{}, &ErrInvocationNotFound{ID: id}
	}
	return inv, nil
}

func (m *memRepo) GetByRunAndIdempotencyKey(ctx context.Context, runID uuid.UUID, key string) (Invocation, error) {
	if m.hideLookupOnce {
		m.hideLookupOnce = false
		return Invocation{}, &ErrInvocationNotFound{}
	}
	id, ok := m.byKey[runID.String()+":"+key]
	if !ok {
		return Invocation{}, &ErrInvocationNotFound{}
	}
	return m.GetInvocation(ctx, id)
}

func (m *memRepo) UpdateResult(ctx context.Context, u ResultUpdate) (Invocation, error) {
	inv, ok := m.invocations[u.ID]
	if !ok {
		return Invocation{}, &ErrInvocationNotFound{ID: u.ID}
	}
	if inv.Version != u.Version || inv.Status != StatusRunning {
		return Invocation{}, &ErrOptimisticLock{ID: u.ID}
	}
	inv.Status = u.Status
	inv.RawArtifactID = u.RawArtifactID
	inv.StructuredArtifactID = u.StructuredArtifactID
	inv.ResultExecution = u.ResultExecution
	inv.ResultParse = u.ResultParse
	inv.ExitCode = u.ExitCode
	inv.ErrorCode = u.ErrorCode
	inv.ErrorMessage = u.ErrorMessage
	ft := u.FinishedAt
	inv.FinishedAt = &ft
	inv.Version++
	m.invocations[u.ID] = inv
	return inv, nil
}

func (m *memRepo) CountByRun(ctx context.Context, runID uuid.UUID) (int64, error) {
	var n int64
	for _, inv := range m.invocations {
		if inv.RunID == runID {
			n++
		}
	}
	return n, nil
}

func (m *memRepo) StartInvocation(ctx context.Context, id uuid.UUID, version int) (Invocation, error) {
	inv, ok := m.invocations[id]
	if !ok {
		return Invocation{}, &ErrInvocationNotFound{ID: id}
	}
	if inv.Version != version || inv.Status != StatusPending {
		return Invocation{}, &ErrOptimisticLock{ID: id}
	}
	inv.Status = StatusRunning
	now := time.Now().UTC()
	inv.StartedAt = &now
	inv.Version++
	m.invocations[id] = inv
	return inv, nil
}

func (m *memRepo) MarkUnknown(ctx context.Context, id uuid.UUID, version int) (Invocation, error) {
	inv, ok := m.invocations[id]
	if !ok {
		return Invocation{}, &ErrInvocationNotFound{ID: id}
	}
	if inv.Version != version || (inv.Status != StatusPending && inv.Status != StatusDispatched && inv.Status != StatusRunning) {
		return Invocation{}, &ErrOptimisticLock{ID: id}
	}
	inv.Status = StatusUnknown
	now := time.Now().UTC()
	inv.FinishedAt = &now
	inv.Version++
	m.invocations[id] = inv
	return inv, nil
}

func (m *memRepo) ListStaleInvocations(ctx context.Context, olderThan time.Time) ([]Invocation, error) {
	out := make([]Invocation, 0)
	for _, inv := range m.invocations {
		if inv.Status != StatusPending && inv.Status != StatusRunning && inv.Status != StatusDispatched {
			continue
		}
		age := inv.CreatedAt
		if inv.StartedAt != nil {
			age = *inv.StartedAt
		}
		if age.Before(olderThan) {
			out = append(out, inv)
		}
	}
	return out, nil
}

func (m *memRepo) CancelInvocationsByRun(ctx context.Context, runID uuid.UUID, from []Status, to Status) (int64, error) {
	in := map[Status]bool{}
	for _, s := range from {
		in[s] = true
	}
	var n int64
	now := time.Now().UTC()
	for id, inv := range m.invocations {
		if inv.RunID == runID && in[inv.Status] {
			inv.Status = to
			inv.FinishedAt = &now
			inv.Version++
			m.invocations[id] = inv
			n++
		}
	}
	return n, nil
}

func (m *memRepo) ListByRun(ctx context.Context, runID uuid.UUID) ([]Invocation, error) {
	out := make([]Invocation, 0)
	for _, inv := range m.invocations {
		if inv.RunID == runID {
			out = append(out, inv)
		}
	}
	return out, nil
}
