package agents

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"
)

func nowUTC() time.Time { return time.Now().UTC() }

// memRepo is an in-memory Repository used by unit tests (no database required).
// It mirrors production semantics: monotonic attempt numbers per agent and
// snapshot dedup by (agent, content hash).
type memRepo struct {
	attempts  map[uuid.UUID]Attempt
	messages  map[uuid.UUID][]Message
	snapshots map[uuid.UUID]Snapshot
	next      int
}

func newMemRepo() *memRepo {
	return &memRepo{
		attempts:  map[uuid.UUID]Attempt{},
		messages:  map[uuid.UUID][]Message{},
		snapshots: map[uuid.UUID]Snapshot{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("agent-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateAttempt(ctx context.Context, p CreateAttemptParams) (Attempt, error) {
	no := 1
	for _, a := range m.attempts {
		if a.AgentID == p.AgentID && a.AttemptNo >= no {
			no = a.AttemptNo + 1
		}
	}
	id := m.newID()
	now := nowUTC()
	a := Attempt{ID: id, AgentID: p.AgentID, AttemptNo: no, Status: AttemptRunning, StartedAt: &now, CreatedAt: now, UpdatedAt: now}
	m.attempts[id] = a
	return a, nil
}

func (m *memRepo) GetAttempt(ctx context.Context, id uuid.UUID) (Attempt, error) {
	a, ok := m.attempts[id]
	if !ok {
		return Attempt{}, &ErrAttemptNotFound{ID: id}
	}
	return a, nil
}

func (m *memRepo) ListAttemptsByAgent(ctx context.Context, agentID uuid.UUID) ([]Attempt, error) {
	out := make([]Attempt, 0)
	for _, a := range m.attempts {
		if a.AgentID == agentID {
			out = append(out, a)
		}
	}
	return out, nil
}

func (m *memRepo) FinishAttempt(ctx context.Context, p FinishAttemptParams) (Attempt, error) {
	a, ok := m.attempts[p.ID]
	if !ok {
		return Attempt{}, &ErrAttemptNotFound{ID: p.ID}
	}
	a.Status = p.Status
	ft := p.FinishedAt
	a.FinishedAt = &ft
	a.UpdatedAt = ft
	m.attempts[p.ID] = a
	return a, nil
}

func (m *memRepo) AppendMessage(ctx context.Context, p AppendMessageParams) (Message, error) {
	if _, ok := m.attempts[p.AttemptID]; !ok {
		return Message{}, &ErrAttemptNotFound{ID: p.AttemptID}
	}
	msg := Message{
		ID: m.newID(), AttemptID: p.AttemptID, Seq: p.Seq, Role: p.Role,
		Content: p.Content, InvocationID: p.InvocationID, CreatedAt: nowUTC(),
	}
	m.messages[p.AttemptID] = append(m.messages[p.AttemptID], msg)
	return msg, nil
}

func (m *memRepo) ListMessages(ctx context.Context, attemptID uuid.UUID) ([]Message, error) {
	return append([]Message{}, m.messages[attemptID]...), nil
}

func (m *memRepo) CreateSnapshot(ctx context.Context, p CreateSnapshotParams) (Snapshot, error) {
	key := p.AgentID.String() + ":" + p.ContentHash
	for _, s := range m.snapshots {
		if s.AgentID.String()+":"+s.ContentHash == key {
			return s, nil
		}
	}
	id := m.newID()
	s := Snapshot{
		ID: id, AgentID: p.AgentID, ProfileRef: p.ProfileRef, ContentHash: p.ContentHash,
		Requested: p.Requested, Granted: p.Granted, CreatedAt: nowUTC(),
	}
	m.snapshots[id] = s
	return s, nil
}

func (m *memRepo) GetSnapshotByAgent(ctx context.Context, agentID uuid.UUID) (Snapshot, error) {
	var latest *Snapshot
	for _, s := range m.snapshots {
		if s.AgentID != agentID {
			continue
		}
		if latest == nil || s.CreatedAt.After(latest.CreatedAt) {
			cp := s
			latest = &cp
		}
	}
	if latest == nil {
		return Snapshot{}, &ErrSnapshotNotFound{AgentID: agentID}
	}
	return *latest, nil
}
