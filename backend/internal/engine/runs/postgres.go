package runs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/engine/runs/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only runs file that touches the store; other packages go through the
// Repository interface or the Service.
type Postgres struct {
	q *storegen.Queries
}

// NewPostgres builds a repository backed by a pgx query executor (a pool or an
// open transaction).
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{q: storegen.New(exec)}
}

// DBTX is the small query interface the repository needs; both *pgxpool.Pool
// and pgx.Tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

func (r *Postgres) CreateRun(ctx context.Context, p CreateRunParams) (Run, error) {
	row, err := r.q.CreateRun(ctx, storegen.CreateRunParams{
		ProjectID: uuidToPG(p.ProjectID),
		ScopeID:   uuidToPG(p.ScopeID),
		Name:      p.Name,
		Status:    string(p.Status),
		CreatedBy: p.CreatedBy,
	})
	if err != nil {
		return Run{}, fmt.Errorf("create run: %w", err)
	}
	return toCreateRun(row), nil
}

func (r *Postgres) CreateOrGetRun(ctx context.Context, p CreateRunParams) (CreateRunResult, error) {
	row, err := r.q.CreateOrGetRun(ctx, storegen.CreateOrGetRunParams{
		ProjectID:          uuidToPG(p.ProjectID),
		ScopeID:            uuidToPG(p.ScopeID),
		Name:               p.Name,
		Status:             string(p.Status),
		CreatedBy:          p.CreatedBy,
		RequestKey:         p.RequestKey,
		RequestFingerprint: p.RequestFingerprint,
	})
	if err != nil {
		return CreateRunResult{}, fmt.Errorf("create or get run: %w", err)
	}
	run := toCreateOrGetRun(row)
	if run.RequestFingerprint != p.RequestFingerprint {
		return CreateRunResult{}, &ErrRequestConflict{RequestKey: p.RequestKey}
	}
	return CreateRunResult{Run: run, Created: row.Created}, nil
}

func (r *Postgres) GetRun(ctx context.Context, id uuid.UUID) (Run, error) {
	row, err := r.q.GetRun(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Run{}, &ErrRunNotFound{ID: id}
		}
		return Run{}, err
	}
	return toGetRun(row), nil
}

func (r *Postgres) TransitionRun(ctx context.Context, id uuid.UUID, version int, newStatus RunStatus) (Run, error) {
	row, err := r.q.TransitionRun(ctx, storegen.TransitionRunParams{
		ID:      uuidToPG(id),
		Status:  string(newStatus),
		Version: int32(version),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Run{}, &ErrOptimisticLock{ID: id}
		}
		return Run{}, err
	}
	return toTransitionRun(row), nil
}

func (r *Postgres) ListRunsByProject(ctx context.Context, projectID uuid.UUID) ([]Run, error) {
	rows, err := r.q.ListRunsByProject(ctx, uuidToPG(projectID))
	if err != nil {
		return nil, err
	}
	out := make([]Run, 0, len(rows))
	for _, row := range rows {
		out = append(out, toListRun(row))
	}
	return out, nil
}

func (r *Postgres) CreateTask(ctx context.Context, p CreateTaskParams) (Task, error) {
	row, err := r.q.CreateTask(ctx, storegen.CreateTaskParams{
		ID:     uuidToPG(p.RunID),
		Name:   p.Name,
		Status: string(p.Status),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Task{}, &ErrRunNotAcceptingWork{ID: p.RunID}
		}
		return Task{}, fmt.Errorf("create task: %w", err)
	}
	return toTask(row), nil
}

func (r *Postgres) GetTask(ctx context.Context, id uuid.UUID) (Task, error) {
	row, err := r.q.GetTask(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Task{}, &ErrTaskNotFound{ID: id}
		}
		return Task{}, err
	}
	return toTask(row), nil
}

func (r *Postgres) TransitionTask(ctx context.Context, id uuid.UUID, version int, newStatus TaskStatus) (Task, error) {
	row, err := r.q.TransitionTask(ctx, storegen.TransitionTaskParams{
		ID:      uuidToPG(id),
		Status:  string(newStatus),
		Version: int32(version),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Task{}, &ErrOptimisticLock{ID: id}
		}
		return Task{}, err
	}
	return toTask(row), nil
}

func (r *Postgres) AddTaskDependency(ctx context.Context, taskID uuid.UUID, dependsOn uuid.UUID, required bool) error {
	return r.q.AddTaskDependency(ctx, storegen.AddTaskDependencyParams{
		TaskID:    uuidToPG(taskID),
		DependsOn: uuidToPG(dependsOn),
		Required:  required,
	})
}

func (r *Postgres) ListTaskDependencies(ctx context.Context, taskID uuid.UUID) ([]TaskDependency, error) {
	rows, err := r.q.ListTaskDependencies(ctx, uuidToPG(taskID))
	if err != nil {
		return nil, err
	}
	out := make([]TaskDependency, 0, len(rows))
	for _, row := range rows {
		out = append(out, TaskDependency{
			TaskID:    pgToUUID(row.TaskID),
			DependsOn: pgToUUID(row.DependsOn),
			Required:  row.Required,
		})
	}
	return out, nil
}

func (r *Postgres) ListTasksByRun(ctx context.Context, runID uuid.UUID) ([]Task, error) {
	rows, err := r.q.ListTasksByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Task, 0, len(rows))
	for _, row := range rows {
		out = append(out, toTask(row))
	}
	return out, nil
}

func (r *Postgres) CreateAgent(ctx context.Context, p CreateAgentParams) (AgentInstance, error) {
	row, err := r.q.CreateAgentInstance(ctx, storegen.CreateAgentInstanceParams{
		ID:      uuidToPG(p.RunID),
		TaskID:  uuidPtrToPG(p.TaskID),
		Profile: p.Profile,
		Status:  string(p.Status),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentInstance{}, &ErrRunNotAcceptingWork{ID: p.RunID}
		}
		return AgentInstance{}, fmt.Errorf("create agent: %w", err)
	}
	return toAgent(row), nil
}

func (r *Postgres) GetAgent(ctx context.Context, id uuid.UUID) (AgentInstance, error) {
	row, err := r.q.GetAgentInstance(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentInstance{}, &ErrAgentNotFound{ID: id}
		}
		return AgentInstance{}, err
	}
	return toAgent(row), nil
}

func (r *Postgres) TransitionAgent(ctx context.Context, id uuid.UUID, version int, newStatus AgentStatus) (AgentInstance, error) {
	row, err := r.q.TransitionAgentInstance(ctx, storegen.TransitionAgentInstanceParams{
		ID:      uuidToPG(id),
		Status:  string(newStatus),
		Version: int32(version),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentInstance{}, &ErrOptimisticLock{ID: id}
		}
		return AgentInstance{}, err
	}
	return toAgent(row), nil
}

func (r *Postgres) ListAgentsByRun(ctx context.Context, runID uuid.UUID) ([]AgentInstance, error) {
	rows, err := r.q.ListAgentInstancesByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]AgentInstance, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAgent(row))
	}
	return out, nil
}

func toCreateRun(r storegen.CreateRunRow) Run {
	return newRun(r.ID, r.ProjectID, r.ScopeID, r.Name, r.Status, r.Version, r.CreatedBy, r.RequestKey, r.RequestFingerprint, r.CreatedAt, r.UpdatedAt)
}

func toCreateOrGetRun(r storegen.CreateOrGetRunRow) Run {
	return newRun(r.ID, r.ProjectID, r.ScopeID, r.Name, r.Status, r.Version, r.CreatedBy, r.RequestKey, r.RequestFingerprint, r.CreatedAt, r.UpdatedAt)
}

func toGetRun(r storegen.GetRunRow) Run {
	return newRun(r.ID, r.ProjectID, r.ScopeID, r.Name, r.Status, r.Version, r.CreatedBy, r.RequestKey, r.RequestFingerprint, r.CreatedAt, r.UpdatedAt)
}

func toTransitionRun(r storegen.TransitionRunRow) Run {
	return newRun(r.ID, r.ProjectID, r.ScopeID, r.Name, r.Status, r.Version, r.CreatedBy, r.RequestKey, r.RequestFingerprint, r.CreatedAt, r.UpdatedAt)
}

func toListRun(r storegen.ListRunsByProjectRow) Run {
	return newRun(r.ID, r.ProjectID, r.ScopeID, r.Name, r.Status, r.Version, r.CreatedBy, r.RequestKey, r.RequestFingerprint, r.CreatedAt, r.UpdatedAt)
}

func newRun(id, projectID, scopeID pgtype.UUID, name, status string, version int32, createdBy, requestKey, requestFingerprint string, createdAt, updatedAt pgtype.Timestamptz) Run {
	return Run{
		ID: idToUUID(id), ProjectID: idToUUID(projectID), ScopeID: idToUUID(scopeID),
		Name: name, Status: RunStatus(status), Version: int(version), CreatedBy: createdBy,
		RequestKey: requestKey, RequestFingerprint: requestFingerprint,
		CreatedAt: pgToTime(createdAt), UpdatedAt: pgToTime(updatedAt),
	}
}

func toTask(t storegen.Task) Task {
	return Task{
		ID:        pgToUUID(t.ID),
		RunID:     pgToUUID(t.RunID),
		Name:      t.Name,
		Status:    TaskStatus(t.Status),
		Version:   int(t.Version),
		CreatedAt: pgToTime(t.CreatedAt),
		UpdatedAt: pgToTime(t.UpdatedAt),
	}
}

func toAgent(a storegen.AgentInstance) AgentInstance {
	return AgentInstance{
		ID:        pgToUUID(a.ID),
		RunID:     pgToUUID(a.RunID),
		TaskID:    pgToUUIDPtr(a.TaskID),
		Profile:   a.Profile,
		Status:    AgentStatus(a.Status),
		Version:   int(a.Version),
		CreatedAt: pgToTime(a.CreatedAt),
		UpdatedAt: pgToTime(a.UpdatedAt),
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// uuidPtrToPG maps an optional task id to a nullable pgtype.UUID.
func uuidPtrToPG(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

func pgToUUID(u pgtype.UUID) uuid.UUID {
	if !u.Valid {
		return uuid.Nil
	}
	return u.Bytes
}

func idToUUID(u pgtype.UUID) uuid.UUID { return pgToUUID(u) }

// pgToUUIDPtr maps a nullable pgtype.UUID to an optional uuid.
func pgToUUIDPtr(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	v := pgToUUID(u)
	return &v
}

func pgToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}
