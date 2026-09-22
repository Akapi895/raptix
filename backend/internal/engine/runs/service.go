package runs

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Service exposes run/task/agent lifecycle operations with business rules
// enforced here. It is the only entry point for lifecycle transitions.
type Service struct {
	repo Repository
}

// NewService wires a runs service over a repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// allowedRunTransitions maps each run status to the set of statuses it may
// transition to.
var allowedRunTransitions = map[RunStatus]map[RunStatus]bool{
	RunQueued:          {RunRunning: true, RunCancelled: true},
	RunRunning:         {RunRunning: true, RunPaused: true, RunCompleted: true, RunCancelled: true, RunBudgetExhausted: true},
	RunPaused:          {RunRunning: true, RunCancelled: true},
	RunCompleted:       {},
	RunCancelled:       {},
	RunBudgetExhausted: {},
}

// allowedTaskTransitions maps each task status to the set of statuses it may
// transition to.
var allowedTaskTransitions = map[TaskStatus]map[TaskStatus]bool{
	TaskQueued:          {TaskRunning: true, TaskCancelled: true},
	TaskRunning:         {TaskRunning: true, TaskPaused: true, TaskCompleted: true, TaskCancelled: true, TaskBudgetExhausted: true},
	TaskPaused:          {TaskRunning: true, TaskCancelled: true},
	TaskCompleted:       {},
	TaskCancelled:       {},
	TaskBudgetExhausted: {},
}

// allowedAgentTransitions maps each agent status to the set of statuses it may
// transition to.
var allowedAgentTransitions = map[AgentStatus]map[AgentStatus]bool{
	AgentPaused:    {AgentRunning: true, AgentCancelled: true},
	AgentRunning:   {AgentRunning: true, AgentPaused: true, AgentCompleted: true, AgentFailed: true, AgentCancelled: true},
	AgentCompleted: {},
	AgentFailed:    {},
	AgentCancelled: {},
}

// StartRun validates the input and creates a run in the queued state.
func (s *Service) StartRun(ctx context.Context, projectID uuid.UUID, name, createdBy string) (Run, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Run{}, fmt.Errorf("run name must not be empty")
	}
	if projectID == uuid.Nil {
		return Run{}, fmt.Errorf("project id is required")
	}
	createdBy = strings.TrimSpace(createdBy)
	if createdBy == "" {
		return Run{}, fmt.Errorf("run creator must not be empty")
	}
	return s.repo.CreateRun(ctx, CreateRunParams{
		ProjectID: projectID,
		Name:      name,
		Status:    RunQueued,
		CreatedBy: createdBy,
	})
}

// GetRun returns a run by id or a typed not-found error. Reading a run through
// the service (not its repository) is required by the Phase 3 acceptance path.
func (s *Service) GetRun(ctx context.Context, id uuid.UUID) (Run, error) {
	return s.repo.GetRun(ctx, id)
}

// ListRunsByProject returns the runs of a project, newest first.
func (s *Service) ListRunsByProject(ctx context.Context, projectID uuid.UUID) ([]Run, error) {
	if projectID == uuid.Nil {
		return nil, fmt.Errorf("project id is required")
	}
	return s.repo.ListRunsByProject(ctx, projectID)
}

// GetTask returns a task by id.
func (s *Service) GetTask(ctx context.Context, id uuid.UUID) (Task, error) {
	return s.repo.GetTask(ctx, id)
}

// GetAgent returns an agent instance by id.
func (s *Service) GetAgent(ctx context.Context, id uuid.UUID) (AgentInstance, error) {
	return s.repo.GetAgent(ctx, id)
}

// ListAgentsByRun returns the agent instances of a run, oldest first.
func (s *Service) ListAgentsByRun(ctx context.Context, runID uuid.UUID) ([]AgentInstance, error) {
	if runID == uuid.Nil {
		return nil, fmt.Errorf("run id is required")
	}
	return s.repo.ListAgentsByRun(ctx, runID)
}

// ListTasksByRun returns the tasks of a run, oldest first.
func (s *Service) ListTasksByRun(ctx context.Context, runID uuid.UUID) ([]Task, error) {
	if runID == uuid.Nil {
		return nil, fmt.Errorf("run id is required")
	}
	return s.repo.ListTasksByRun(ctx, runID)
}

// RunCancelResult reports how many entities a CancelRun call transitioned.
type RunCancelResult struct {
	RunCancelled    bool
	TasksCancelled  int
	AgentsCancelled int
}

// CancelRun transitions a run and its tasks/agents to cancelled. It is
// idempotent for an already-terminal run (queued/running/paused are cancelled;
// a run already completed/cancelled/budget-exhausted is left alone). Per-item
// optimistic-lock failures are skipped so a concurrent caller finishing an
// item does not abort the whole cascade.
func (s *Service) CancelRun(ctx context.Context, runID uuid.UUID) (RunCancelResult, error) {
	if runID == uuid.Nil {
		return RunCancelResult{}, fmt.Errorf("run id is required")
	}
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return RunCancelResult{}, err
	}
	if run.Status == RunCompleted || run.Status == RunBudgetExhausted {
		return RunCancelResult{}, nil
	}
	res := RunCancelResult{}
	if run.Status != RunCancelled {
		if _, err := s.TransitionRun(ctx, run.ID, run.Version, RunCancelled); err != nil {
			return RunCancelResult{}, err
		}
		res.RunCancelled = true
	}

	tasks, err := s.repo.ListTasksByRun(ctx, runID)
	if err != nil {
		return res, err
	}
	for _, t := range tasks {
		if isTerminalTask(t.Status) {
			continue
		}
		if _, err := s.repo.TransitionTask(ctx, t.ID, t.Version, TaskCancelled); err != nil {
			if isOptimisticLock(err) {
				continue
			}
			return res, err
		}
		res.TasksCancelled++
	}

	agents, err := s.repo.ListAgentsByRun(ctx, runID)
	if err != nil {
		return res, err
	}
	for _, a := range agents {
		if isTerminalAgent(a.Status) {
			continue
		}
		if _, err := s.repo.TransitionAgent(ctx, a.ID, a.Version, AgentCancelled); err != nil {
			if isOptimisticLock(err) {
				continue
			}
			return res, err
		}
		res.AgentsCancelled++
	}
	return res, nil
}

func isTerminalTask(s TaskStatus) bool {
	return s == TaskCompleted || s == TaskCancelled || s == TaskBudgetExhausted
}

func isTerminalAgent(s AgentStatus) bool {
	return s == AgentCompleted || s == AgentFailed || s == AgentCancelled
}

func isOptimisticLock(err error) bool {
	var ol *ErrOptimisticLock
	return errors.As(err, &ol)
}

// TransitionRun applies a status transition to a run, rejecting transitions
// not described by the transition table.
func (s *Service) TransitionRun(ctx context.Context, id uuid.UUID, fromVersion int, toStatus RunStatus) (Run, error) {
	cur, err := s.repo.GetRun(ctx, id)
	if err != nil {
		return Run{}, err
	}
	if !allowedRunTransitions[cur.Status][toStatus] {
		return Run{}, fmt.Errorf("illegal run transition %s -> %s", cur.Status, toStatus)
	}
	return s.repo.TransitionRun(ctx, id, fromVersion, toStatus)
}

// initialTaskStatuses are the states a task may be created in. Terminal states
// and unknown strings are rejected: a task reaches them only by transition.
var initialTaskStatuses = map[TaskStatus]bool{
	TaskQueued: true,
	TaskPaused: true,
}

// CreateTask validates the input and creates a task in a legal initial state.
func (s *Service) CreateTask(ctx context.Context, runID uuid.UUID, name string, status TaskStatus) (Task, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Task{}, fmt.Errorf("task name must not be empty")
	}
	if runID == uuid.Nil {
		return Task{}, fmt.Errorf("run id is required")
	}
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return Task{}, err
	}
	if run.Status == RunCancelled || run.Status == RunCompleted || run.Status == RunBudgetExhausted {
		return Task{}, &ErrRunNotAcceptingWork{ID: runID}
	}
	if !initialTaskStatuses[status] {
		return Task{}, fmt.Errorf("task cannot start in status %q", status)
	}
	return s.repo.CreateTask(ctx, CreateTaskParams{RunID: runID, Name: name, Status: status})
}

// TransitionTask applies a status transition to a task, rejecting transitions
// not described by the transition table.
func (s *Service) TransitionTask(ctx context.Context, id uuid.UUID, fromVersion int, toStatus TaskStatus) (Task, error) {
	cur, err := s.repo.GetTask(ctx, id)
	if err != nil {
		return Task{}, err
	}
	if !allowedTaskTransitions[cur.Status][toStatus] {
		return Task{}, fmt.Errorf("illegal task transition %s -> %s", cur.Status, toStatus)
	}
	return s.repo.TransitionTask(ctx, id, fromVersion, toStatus)
}

// AddTaskDependency records that one task depends on another. Both tasks must
// belong to the same run and a task cannot depend on itself; this is the only
// supported way to write the dependency graph.
func (s *Service) AddTaskDependency(ctx context.Context, taskID, dependsOn uuid.UUID, required bool) error {
	if taskID == uuid.Nil || dependsOn == uuid.Nil {
		return fmt.Errorf("task ids are required")
	}
	if taskID == dependsOn {
		return fmt.Errorf("a task cannot depend on itself")
	}
	task, err := s.repo.GetTask(ctx, taskID)
	if err != nil {
		return err
	}
	other, err := s.repo.GetTask(ctx, dependsOn)
	if err != nil {
		return err
	}
	if task.RunID != other.RunID {
		return fmt.Errorf("task dependency must stay within one run")
	}
	return s.repo.AddTaskDependency(ctx, taskID, dependsOn, required)
}

// ListTaskDependencies returns the dependencies of a task.
func (s *Service) ListTaskDependencies(ctx context.Context, taskID uuid.UUID) ([]TaskDependency, error) {
	return s.repo.ListTaskDependencies(ctx, taskID)
}

// CreateAgent validates the input and creates an agent instance paused. When a
// task is supplied it must belong to the same run, so an agent can never be
// attached to another run's work.
func (s *Service) CreateAgent(ctx context.Context, runID uuid.UUID, taskID *uuid.UUID, profile string) (AgentInstance, error) {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return AgentInstance{}, fmt.Errorf("agent profile must not be empty")
	}
	if runID == uuid.Nil {
		return AgentInstance{}, fmt.Errorf("run id is required")
	}
	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		return AgentInstance{}, err
	}
	if run.Status == RunCancelled || run.Status == RunCompleted || run.Status == RunBudgetExhausted {
		return AgentInstance{}, &ErrRunNotAcceptingWork{ID: runID}
	}
	if taskID != nil {
		task, err := s.repo.GetTask(ctx, *taskID)
		if err != nil {
			return AgentInstance{}, err
		}
		if task.RunID != runID {
			return AgentInstance{}, fmt.Errorf("task %s does not belong to run %s", taskID, runID)
		}
	}
	return s.repo.CreateAgent(ctx, CreateAgentParams{
		RunID:   runID,
		TaskID:  taskID,
		Profile: profile,
		Status:  AgentPaused,
	})
}

// TransitionAgent applies a status transition to an agent instance, rejecting
// transitions not described by the transition table.
func (s *Service) TransitionAgent(ctx context.Context, id uuid.UUID, fromVersion int, toStatus AgentStatus) (AgentInstance, error) {
	cur, err := s.repo.GetAgent(ctx, id)
	if err != nil {
		return AgentInstance{}, err
	}
	if !allowedAgentTransitions[cur.Status][toStatus] {
		return AgentInstance{}, fmt.Errorf("illegal agent transition %s -> %s", cur.Status, toStatus)
	}
	return s.repo.TransitionAgent(ctx, id, fromVersion, toStatus)
}
