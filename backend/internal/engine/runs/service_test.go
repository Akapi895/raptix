package runs

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
type memRepo struct {
	runs    map[uuid.UUID]Run
	tasks   map[uuid.UUID]Task
	agents  map[uuid.UUID]AgentInstance
	deps    map[uuid.UUID][]TaskDependency
	next    int
	version map[uuid.UUID]int
}

func newMemRepo() *memRepo {
	return &memRepo{
		runs:    map[uuid.UUID]Run{},
		tasks:   map[uuid.UUID]Task{},
		agents:  map[uuid.UUID]AgentInstance{},
		deps:    map[uuid.UUID][]TaskDependency{},
		version: map[uuid.UUID]int{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	b := [16]byte{}
	b[0] = byte(m.next & 0xff)
	return b
}

func (m *memRepo) CreateRun(ctx context.Context, p CreateRunParams) (Run, error) {
	id := m.newID()
	r := Run{ID: id, ProjectID: p.ProjectID, Name: p.Name, Status: p.Status, Version: 1, CreatedBy: p.CreatedBy}
	m.runs[id] = r
	m.version[id] = 1
	return r, nil
}

func (m *memRepo) GetRun(ctx context.Context, id uuid.UUID) (Run, error) {
	r, ok := m.runs[id]
	if !ok {
		return Run{}, &ErrRunNotFound{ID: id}
	}
	return r, nil
}

func (m *memRepo) TransitionRun(ctx context.Context, id uuid.UUID, version int, newStatus RunStatus) (Run, error) {
	r, ok := m.runs[id]
	if !ok {
		return Run{}, &ErrRunNotFound{ID: id}
	}
	if r.Version != version {
		return Run{}, &ErrOptimisticLock{ID: id}
	}
	r.Status = newStatus
	r.Version++
	m.runs[id] = r
	return r, nil
}

func (m *memRepo) ListRunsByProject(ctx context.Context, projectID uuid.UUID) ([]Run, error) {
	out := make([]Run, 0)
	for _, r := range m.runs {
		if r.ProjectID == projectID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (m *memRepo) CreateTask(ctx context.Context, p CreateTaskParams) (Task, error) {
	id := m.newID()
	t := Task{ID: id, RunID: p.RunID, Name: p.Name, Status: p.Status, Version: 1}
	m.tasks[id] = t
	return t, nil
}

func (m *memRepo) GetTask(ctx context.Context, id uuid.UUID) (Task, error) {
	t, ok := m.tasks[id]
	if !ok {
		return Task{}, &ErrTaskNotFound{ID: id}
	}
	return t, nil
}

func (m *memRepo) TransitionTask(ctx context.Context, id uuid.UUID, version int, newStatus TaskStatus) (Task, error) {
	t, ok := m.tasks[id]
	if !ok {
		return Task{}, &ErrTaskNotFound{ID: id}
	}
	if t.Version != version {
		return Task{}, &ErrOptimisticLock{ID: id}
	}
	t.Status = newStatus
	t.Version++
	m.tasks[id] = t
	return t, nil
}

func (m *memRepo) AddTaskDependency(ctx context.Context, taskID uuid.UUID, dependsOn uuid.UUID, required bool) error {
	m.deps[taskID] = append(m.deps[taskID], TaskDependency{TaskID: taskID, DependsOn: dependsOn, Required: required})
	return nil
}

func (m *memRepo) ListTaskDependencies(ctx context.Context, taskID uuid.UUID) ([]TaskDependency, error) {
	return append([]TaskDependency(nil), m.deps[taskID]...), nil
}

func (m *memRepo) CreateAgent(ctx context.Context, p CreateAgentParams) (AgentInstance, error) {
	id := m.newID()
	a := AgentInstance{ID: id, RunID: p.RunID, TaskID: p.TaskID, Profile: p.Profile, Status: p.Status, Version: 1}
	m.agents[id] = a
	return a, nil
}

func (m *memRepo) GetAgent(ctx context.Context, id uuid.UUID) (AgentInstance, error) {
	a, ok := m.agents[id]
	if !ok {
		return AgentInstance{}, &ErrAgentNotFound{ID: id}
	}
	return a, nil
}

func (m *memRepo) TransitionAgent(ctx context.Context, id uuid.UUID, version int, newStatus AgentStatus) (AgentInstance, error) {
	a, ok := m.agents[id]
	if !ok {
		return AgentInstance{}, &ErrAgentNotFound{ID: id}
	}
	if a.Version != version {
		return AgentInstance{}, &ErrOptimisticLock{ID: id}
	}
	a.Status = newStatus
	a.Version++
	m.agents[id] = a
	return a, nil
}

func TestCreateRunValidatesInput(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	pid := uuid.New()

	if _, err := svc.StartRun(ctx, uuid.Nil, "run", "alice"); err == nil {
		t.Error("expected missing-project error")
	}
	if _, err := svc.StartRun(ctx, pid, "  ", "alice"); err == nil {
		t.Error("expected empty-name error")
	}

	r, err := svc.StartRun(ctx, pid, "Recon", "alice")
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	if r.Status != RunQueued || r.Version != 1 {
		t.Errorf("run = %+v", r)
	}
}

func TestLegalTransitionIncrementsVersion(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")

	upd, err := svc.TransitionRun(ctx, r.ID, r.Version, RunRunning)
	if err != nil {
		t.Fatalf("transition: %v", err)
	}
	if upd.Status != RunRunning {
		t.Errorf("status = %s, want running", upd.Status)
	}
	if upd.Version != r.Version+1 {
		t.Errorf("version = %d, want %d", upd.Version, r.Version+1)
	}

	upd, err = svc.TransitionRun(ctx, r.ID, upd.Version, RunCompleted)
	if err != nil {
		t.Fatalf("transition to completed: %v", err)
	}
	if upd.Status != RunCompleted || upd.Version != 3 {
		t.Errorf("run = %+v", upd)
	}
}

func TestIllegalTransitionRejected(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")

	upd, err := svc.TransitionRun(ctx, r.ID, r.Version, RunRunning)
	if err != nil {
		t.Fatalf("transition: %v", err)
	}
	if _, err := svc.TransitionRun(ctx, r.ID, upd.Version, RunCancelled); err != nil {
		t.Fatalf("cancel running: %v", err)
	}

	// cancelled -> running is illegal
	if _, err := svc.TransitionRun(ctx, r.ID, 3, RunRunning); err == nil {
		t.Error("expected illegal cancelled->running error")
	}
}

func TestOptimisticLockSurfacesErr(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")

	// Pass a stale version: the stored version is 1 but transition expects 2.
	if _, err := svc.TransitionRun(ctx, r.ID, 2, RunRunning); err == nil {
		t.Fatal("expected optimistic-lock error")
	} else {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			t.Fatalf("error = %v, want ErrOptimisticLock", err)
		}
	}
}

func TestBudgetExhaustedDistinctFromCompleted(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")

	if RunBudgetExhausted == RunCompleted {
		t.Fatal("budget_exhausted must be distinct from completed")
	}

	upd, err := svc.TransitionRun(ctx, r.ID, r.Version, RunRunning)
	if err != nil {
		t.Fatalf("transition to running: %v", err)
	}
	upd, err = svc.TransitionRun(ctx, r.ID, upd.Version, RunBudgetExhausted)
	if err != nil {
		t.Fatalf("transition to budget_exhausted: %v", err)
	}
	if upd.Status != RunBudgetExhausted {
		t.Errorf("status = %s, want budget_exhausted", upd.Status)
	}

	// A completed run must not be reachable from budget_exhausted or vice versa
	// through the transition table.
	if _, ok := allowedRunTransitions[RunBudgetExhausted]; !ok {
		t.Fatal("budget_exhausted must be a known run status in the transition table")
	}
	if allowedRunTransitions[RunBudgetExhausted][RunCompleted] {
		t.Error("budget_exhausted must not transition to completed")
	}
}

func TestTaskLifecycle(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")

	if _, err := svc.CreateTask(ctx, r.ID, "", TaskQueued); err == nil {
		t.Error("expected empty-task-name error")
	}

	tk, err := svc.CreateTask(ctx, r.ID, "Scan", TaskQueued)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if tk.Status != TaskQueued || tk.Version != 1 {
		t.Errorf("task = %+v", tk)
	}

	tk, err = svc.TransitionTask(ctx, tk.ID, tk.Version, TaskRunning)
	if err != nil {
		t.Fatalf("transition task: %v", err)
	}
	if tk.Status != TaskRunning || tk.Version != 2 {
		t.Errorf("task = %+v", tk)
	}

	if _, err := svc.TransitionTask(ctx, tk.ID, tk.Version, TaskQueued); err == nil {
		t.Error("expected illegal running->queued error")
	}
}

func TestAgentLifecycle(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")
	tk, _ := svc.CreateTask(ctx, r.ID, "Scan", TaskQueued)

	if _, err := svc.CreateAgent(ctx, r.ID, nil, "  "); err == nil {
		t.Error("expected empty-profile error")
	}

	a, err := svc.CreateAgent(ctx, r.ID, &tk.ID, "recon-agent")
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	if a.Status != AgentPaused || a.Version != 1 {
		t.Errorf("agent = %+v", a)
	}

	a, err = svc.TransitionAgent(ctx, a.ID, a.Version, AgentRunning)
	if err != nil {
		t.Fatalf("transition agent: %v", err)
	}
	if a.Status != AgentRunning || a.Version != 2 {
		t.Errorf("agent = %+v", a)
	}

	if _, err := svc.TransitionAgent(ctx, a.ID, a.Version, AgentPaused); err != nil {
		t.Fatalf("pause running agent: %v", err)
	}
	if _, err := svc.TransitionAgent(ctx, a.ID, 3, AgentFailed); err == nil {
		t.Error("expected illegal paused->failed error")
	}
}

func TestTaskDependencyRecorded(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")
	a, err := svc.CreateTask(ctx, r.ID, "A", TaskQueued)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.CreateTask(ctx, r.ID, "B", TaskQueued)
	if err != nil {
		t.Fatal(err)
	}

	if err := svc.AddTaskDependency(ctx, b.ID, a.ID, true); err != nil {
		t.Fatal(err)
	}
	deps, err := svc.ListTaskDependencies(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(deps) != 1 || deps[0].DependsOn != a.ID || !deps[0].Required {
		t.Errorf("deps = %+v", deps)
	}

	// A task cannot depend on itself.
	if err := svc.AddTaskDependency(ctx, a.ID, a.ID, true); err == nil {
		t.Error("expected self-dependency rejection")
	}

	// Dependencies must stay within one run.
	r2, _ := svc.StartRun(ctx, uuid.New(), "Other", "alice")
	c, _ := svc.CreateTask(ctx, r2.ID, "C", TaskQueued)
	if err := svc.AddTaskDependency(ctx, b.ID, c.ID, true); err == nil {
		t.Error("expected cross-run dependency rejection")
	}
}

func TestCreateTaskRejectsTerminalStatus(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r, _ := svc.StartRun(ctx, uuid.New(), "Recon", "alice")
	if _, err := svc.CreateTask(ctx, r.ID, "done", TaskCompleted); err == nil {
		t.Error("expected terminal-status rejection")
	}
	if _, err := svc.CreateTask(ctx, r.ID, "bogus", TaskStatus("bogus")); err == nil {
		t.Error("expected unknown-status rejection")
	}
}

func TestCreateAgentRejectsForeignTask(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	r1, _ := svc.StartRun(ctx, uuid.New(), "One", "alice")
	r2, _ := svc.StartRun(ctx, uuid.New(), "Two", "alice")
	taskOfRun2, _ := svc.CreateTask(ctx, r2.ID, "T", TaskQueued)
	if _, err := svc.CreateAgent(ctx, r1.ID, &taskOfRun2.ID, "recon-agent"); err == nil {
		t.Error("expected agent/task run-mismatch rejection")
	}
}
