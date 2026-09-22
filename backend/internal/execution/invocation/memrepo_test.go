package invocation

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
// It mirrors production semantics: idempotency by (run, key) and optimistic
// version on result updates.
type memRepo struct {
	invocations map[uuid.UUID]Invocation
	byKey       map[string]uuid.UUID
	next        int
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
		return m.invocations[id], fmt.Errorf("duplicate idempotency key")
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
	if inv.Version != u.Version {
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

func (m *memRepo) ListByRun(ctx context.Context, runID uuid.UUID) ([]Invocation, error) {
	out := make([]Invocation, 0)
	for _, inv := range m.invocations {
		if inv.RunID == runID {
			out = append(out, inv)
		}
	}
	return out, nil
}
