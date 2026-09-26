package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/api"
	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
	"github.com/Akapi895/raptix/backend/internal/workspace/reporting"
)

// HTTPUseCases exposes only authorized, transport-safe application operations.
// The API package cannot access module stores directly.
func (s *Services) HTTPUseCases(hub *api.Hub) api.UseCases {
	return &httpUseCases{services: s, hub: hub}
}

type httpUseCases struct {
	services *Services
	hub      *api.Hub
}

func (h *httpUseCases) project(ctx context.Context, p api.Principal, id uuid.UUID) (projects.Project, error) {
	project, err := h.services.Projects.GetProjectByID(ctx, id)
	if err != nil {
		return projects.Project{}, api.NotFound("project was not found")
	}
	role, err := h.services.Projects.GetMemberRole(ctx, id, p.Subject)
	if err != nil {
		return projects.Project{}, unavailable(err)
	}
	if role == "" {
		return projects.Project{}, api.NotFound("project was not found")
	}
	return project, nil
}
func (h *httpUseCases) run(ctx context.Context, p api.Principal, id uuid.UUID, capability string) (runs.Run, error) {
	run, err := h.services.Runs.GetRun(ctx, id)
	if err != nil {
		return runs.Run{}, api.NotFound("run was not found")
	}
	if _, err := h.project(ctx, p, run.ProjectID); err != nil {
		return runs.Run{}, err
	}
	ok, err := h.services.Governance.CheckActiveGrant(ctx, p.Subject, run.ScopeID, capability)
	if err != nil {
		return runs.Run{}, unavailable(err)
	}
	if !ok {
		h.audit(ctx, p.Subject, capability, run.ID, "no active grant in the run scope")
		return runs.Run{}, api.Forbidden("the current scope does not grant this capability")
	}
	return run, nil
}

// audit records an authorization denial at the transport boundary. The decision
// to deny is governance's; recording it here makes a denied command traceable.
func (h *httpUseCases) audit(ctx context.Context, actor, action string, runID uuid.UUID, reason string) {
	if h.services.Audit == nil {
		return
	}
	_, _ = h.services.Audit.Record(ctx, audit.Record{
		Actor:       actor,
		Action:      action,
		Resource:    runID.String(),
		Outcome:     audit.OutcomeDenied,
		Reason:      reason,
		Correlation: runID.String(),
	})
}
func (h *httpUseCases) publish(runID uuid.UUID, action string) {
	if h.hub != nil {
		h.hub.Publish(runID, "updated", map[string]string{"action": action, "runId": runID.String()})
	}
}

func (h *httpUseCases) ListProjects(ctx context.Context, p api.Principal) ([]api.Project, error) {
	all, err := h.services.Projects.ListProjects(ctx)
	if err != nil {
		return nil, unavailable(err)
	}
	out := make([]api.Project, 0, len(all))
	for _, v := range all {
		role, e := h.services.Projects.GetMemberRole(ctx, v.ID, p.Subject)
		if e != nil {
			return nil, unavailable(e)
		}
		if role != "" {
			out = append(out, projectView(v))
		}
	}
	return out, nil
}
func (h *httpUseCases) GetProject(ctx context.Context, p api.Principal, id uuid.UUID) (api.Project, error) {
	v, e := h.project(ctx, p, id)
	return projectView(v), e
}
func (h *httpUseCases) ListScopes(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Scope, error) {
	if _, e := h.project(ctx, p, id); e != nil {
		return nil, e
	}
	v, e := h.services.Projects.ListScopes(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Scope, len(v))
	for i := range v {
		out[i] = scopeView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) ListRuns(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Run, error) {
	if _, e := h.project(ctx, p, id); e != nil {
		return nil, e
	}
	v, e := h.services.Runs.ListRunsByProject(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Run, 0, len(v))
	for _, run := range v {
		ok, e := h.services.Governance.CheckActiveGrant(ctx, p.Subject, run.ScopeID, "run.read")
		if e != nil {
			return nil, unavailable(e)
		}
		if ok {
			out = append(out, runView(run))
		}
	}
	return out, nil
}
func (h *httpUseCases) CreateRun(ctx context.Context, p api.Principal, projectID, scopeID uuid.UUID, name, key string) (api.Run, error) {
	v, e := h.services.StartAuthorizedRun(ctx, StartRunParams{ProjectID: projectID, ScopeID: scopeID, Actor: p.Subject, Name: name, RequestKey: key})
	if e != nil {
		return api.Run{}, useCaseError(e)
	}
	h.publish(v.ID, "run.created")
	return runView(v), nil
}
func (h *httpUseCases) GetRun(ctx context.Context, p api.Principal, id uuid.UUID) (api.Run, error) {
	v, e := h.run(ctx, p, id, "run.read")
	return runView(v), e
}
func (h *httpUseCases) ListTasks(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Task, error) {
	if _, e := h.run(ctx, p, id, "run.read"); e != nil {
		return nil, e
	}
	v, e := h.services.Runs.ListTasksByRun(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Task, len(v))
	for i := range v {
		out[i] = taskView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) ListAgents(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Agent, error) {
	if _, e := h.run(ctx, p, id, "run.read"); e != nil {
		return nil, e
	}
	v, e := h.services.Runs.ListAgentsByRun(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Agent, len(v))
	for i := range v {
		out[i] = agentView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) CreateAgent(ctx context.Context, p api.Principal, runID uuid.UUID, taskID *uuid.UUID, profile, key string) (api.Agent, error) {
	if _, e := h.run(ctx, p, runID, "run.control"); e != nil {
		return api.Agent{}, e
	}
	_ = key // Agent rows do not persist a request key; attempts do, and remain the replayable execution boundary.
	v, e := h.services.Runs.CreateAgent(ctx, runID, taskID, profile)
	if e != nil {
		return api.Agent{}, useCaseError(e)
	}
	h.publish(runID, "agent.created")
	return agentView(v), nil
}
func (h *httpUseCases) RunAgentAttempt(ctx context.Context, p api.Principal, agentID uuid.UUID, task, key string) (api.AttemptResult, error) {
	agent, e := h.services.Runs.GetAgent(ctx, agentID)
	if e != nil {
		return api.AttemptResult{}, api.NotFound("agent was not found")
	}
	if _, e = h.run(ctx, p, agent.RunID, "run.control"); e != nil {
		return api.AttemptResult{}, e
	}
	v, e := h.services.RunAgent(ctx, RunAgentParams{AgentID: agentID, Actor: p.Subject, Task: task, RequestKey: key})
	if e != nil {
		return api.AttemptResult{Attempt: attemptView(v.Attempt), Summary: v.Summary, FindingID: v.FindingID}, useCaseError(e)
	}
	h.publish(agent.RunID, "agent.attempt.completed")
	return api.AttemptResult{Attempt: attemptView(v.Attempt), Summary: v.Summary, FindingID: v.FindingID}, nil
}
func (h *httpUseCases) CancelRun(ctx context.Context, p api.Principal, id uuid.UUID) (api.Run, error) {
	if _, e := h.run(ctx, p, id, "run.control"); e != nil {
		return api.Run{}, e
	}
	if _, e := h.services.CancelRunAs(ctx, id, p.Subject); e != nil {
		return api.Run{}, useCaseError(e)
	}
	v, e := h.services.Runs.GetRun(ctx, id)
	if e != nil {
		return api.Run{}, unavailable(e)
	}
	h.publish(id, "run.cancelled")
	return runView(v), nil
}
func (h *httpUseCases) ListEvidence(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Evidence, error) {
	if _, e := h.run(ctx, p, id, "evidence.read"); e != nil {
		return nil, e
	}
	v, e := h.services.Evidence.ListByRun(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Evidence, len(v))
	for i := range v {
		out[i] = evidenceView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) GetEvidence(ctx context.Context, p api.Principal, id uuid.UUID) (api.Evidence, error) {
	v, e := h.evidence(ctx, p, id)
	return evidenceView(v), e
}
func (h *httpUseCases) OpenEvidence(ctx context.Context, p api.Principal, id uuid.UUID) (api.Evidence, io.ReadCloser, error) {
	v, e := h.evidence(ctx, p, id)
	if e != nil {
		return api.Evidence{}, nil, e
	}
	if v.Sensitivity == evidence.SensitivitySecret {
		return api.Evidence{}, nil, api.Forbidden("secret evidence content cannot be downloaded")
	}
	rc, e := h.services.Evidence.ReadRef(ctx, v)
	if e != nil {
		return api.Evidence{}, nil, unavailable(e)
	}
	return evidenceView(v), rc, nil
}
func (h *httpUseCases) evidence(ctx context.Context, p api.Principal, id uuid.UUID) (evidence.Artifact, error) {
	v, e := h.services.Evidence.GetArtifact(ctx, id)
	if e != nil {
		return evidence.Artifact{}, api.NotFound("evidence was not found")
	}
	if v.RunID == nil {
		return evidence.Artifact{}, api.NotFound("evidence was not found")
	}
	if _, e := h.run(ctx, p, *v.RunID, "evidence.read"); e != nil {
		return evidence.Artifact{}, e
	}
	return v, nil
}
func (h *httpUseCases) ListFindings(ctx context.Context, p api.Principal, id uuid.UUID) ([]api.Finding, error) {
	if _, e := h.run(ctx, p, id, "finding.read"); e != nil {
		return nil, e
	}
	v, e := h.services.Findings.ListFindingsByRun(ctx, id)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.Finding, len(v))
	for i := range v {
		out[i] = findingView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) GetFinding(ctx context.Context, p api.Principal, id uuid.UUID) (api.Finding, error) {
	v, e := h.services.Findings.GetFinding(ctx, id)
	if e != nil {
		return api.Finding{}, api.NotFound("finding was not found")
	}
	if _, e := h.run(ctx, p, v.RunID, "finding.read"); e != nil {
		return api.Finding{}, e
	}
	return findingView(v), nil
}
func (h *httpUseCases) ListFindingRevisions(ctx context.Context, p api.Principal, findingID uuid.UUID) ([]api.FindingRevision, error) {
	if _, e := h.finding(ctx, p, findingID, "finding.read"); e != nil {
		return nil, e
	}
	v, e := h.services.Findings.ListRevisions(ctx, findingID)
	if e != nil {
		return nil, unavailable(e)
	}
	out := make([]api.FindingRevision, len(v))
	for i := range v {
		out[i] = revisionView(v[i])
	}
	return out, nil
}
func (h *httpUseCases) ReviseFinding(ctx context.Context, p api.Principal, findingID uuid.UUID, expectedVersion int, input api.ReviseFindingInput) (api.Finding, error) {
	if _, e := h.finding(ctx, p, findingID, "finding.review"); e != nil {
		return api.Finding{}, e
	}
	if expectedVersion <= 0 {
		return api.Finding{}, api.BadRequest("expectedVersion is required")
	}
	evidence := make([]findings.EvidenceRef, 0, len(input.Evidence))
	for _, ref := range input.Evidence {
		evidence = append(evidence, findings.EvidenceRef{EvidenceID: ref.EvidenceID, Role: ref.Role})
	}
	v, e := h.services.Findings.ReviseFinding(ctx, findings.ReviseFindingParams{
		FindingID: findingID, ExpectedVersion: expectedVersion, Title: input.Title,
		Description: input.Description, Severity: findings.Severity(input.Severity),
		Confidence: findings.Confidence(input.Confidence), Evidence: evidence,
		Reason: input.Reason, Actor: p.Subject,
	})
	if e != nil {
		return api.Finding{}, findingError(e)
	}
	h.publish(v.RunID, "finding.revised")
	return findingView(v), nil
}
func (h *httpUseCases) ReviewFinding(ctx context.Context, p api.Principal, findingID uuid.UUID, expectedVersion int, decision, reason string) (api.Finding, error) {
	if _, e := h.finding(ctx, p, findingID, "finding.review"); e != nil {
		return api.Finding{}, e
	}
	status, ok := reviewDecision(decision)
	if !ok {
		return api.Finding{}, api.BadRequest("decision must be reviewed, confirmed, rejected or inconclusive")
	}
	if expectedVersion <= 0 {
		return api.Finding{}, api.BadRequest("expectedVersion is required")
	}
	v, e := h.services.Findings.ReviewFinding(ctx, findings.ReviewFindingParams{
		FindingID: findingID, ExpectedVersion: expectedVersion, Status: status,
		Reviewer: p.Subject, Reason: reason,
	})
	if e != nil {
		return api.Finding{}, findingError(e)
	}
	h.publish(v.RunID, "finding.reviewed")
	return findingView(v), nil
}
func (h *httpUseCases) CreateReport(ctx context.Context, p api.Principal, runID uuid.UUID, templateID, templateVersion, key string) (api.Report, error) {
	if _, e := h.run(ctx, p, runID, "report.create"); e != nil {
		return api.Report{}, e
	}
	_ = key // The report request is idempotent per run and template revision.
	v, e := h.services.CreateAuthorizedReport(ctx, reportRequestParams{RunID: runID, TemplateID: templateID, TemplateVersion: templateVersion})
	if e != nil {
		return api.Report{}, useCaseError(e)
	}
	h.publish(runID, "report.queued")
	return reportView(v), nil
}
func (h *httpUseCases) GetReport(ctx context.Context, p api.Principal, reportID uuid.UUID) (api.Report, error) {
	v, e := h.report(ctx, p, reportID, "report.read")
	return reportView(v), e
}
func (h *httpUseCases) OpenReportContent(ctx context.Context, p api.Principal, reportID uuid.UUID) (api.Report, io.ReadCloser, error) {
	report, e := h.report(ctx, p, reportID, "report.read")
	if e != nil {
		return api.Report{}, nil, e
	}
	if report.Status != reporting.StatusCompleted {
		return api.Report{}, nil, api.NotFound("report content is not available")
	}
	_, rc, e := h.services.OpenAuthorizedReportContent(ctx, reportID)
	if e != nil {
		return api.Report{}, nil, unavailable(e)
	}
	return reportView(report), rc, nil
}
func (h *httpUseCases) finding(ctx context.Context, p api.Principal, findingID uuid.UUID, capability string) (findings.Finding, error) {
	finding, err := h.services.Findings.GetFinding(ctx, findingID)
	if err != nil {
		return findings.Finding{}, api.NotFound("finding was not found")
	}
	if _, err := h.run(ctx, p, finding.RunID, capability); err != nil {
		return findings.Finding{}, err
	}
	return finding, nil
}
func (h *httpUseCases) report(ctx context.Context, p api.Principal, reportID uuid.UUID, capability string) (reporting.Report, error) {
	report, err := h.services.Reporting.Get(ctx, reportID)
	if err != nil {
		return reporting.Report{}, api.NotFound("report was not found")
	}
	if _, err := h.run(ctx, p, report.RunID, capability); err != nil {
		return reporting.Report{}, err
	}
	return report, nil
}

func (h *httpUseCases) Snapshot(ctx context.Context, p api.Principal, id uuid.UUID) (api.RunSnapshot, error) {
	run, e := h.run(ctx, p, id, "run.read")
	if e != nil {
		return api.RunSnapshot{}, e
	}
	tasks, e := h.ListTasks(ctx, p, id)
	if e != nil {
		return api.RunSnapshot{}, e
	}
	agents, e := h.ListAgents(ctx, p, id)
	if e != nil {
		return api.RunSnapshot{}, e
	}
	return api.RunSnapshot{Run: runView(run), Tasks: tasks, Agents: agents}, nil
}

func projectView(v projects.Project) api.Project {
	return api.Project{ID: v.ID, Name: v.Name, Slug: v.Slug, Status: string(v.Status), CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func scopeView(v projects.Scope) api.Scope {
	return api.Scope{ID: v.ID, ProjectID: v.ProjectID, Version: v.Version, AssetTypes: v.AssetTypes, Include: v.Include, Exclude: v.Exclude, ExpiresAt: v.ExpiresAt, ApprovalNote: v.ApprovalNote, CreatedAt: v.CreatedAt}
}
func runView(v runs.Run) api.Run {
	return api.Run{ID: v.ID, ProjectID: v.ProjectID, ScopeID: v.ScopeID, Name: v.Name, Status: string(v.Status), Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func taskView(v runs.Task) api.Task {
	return api.Task{ID: v.ID, RunID: v.RunID, Name: v.Name, Status: string(v.Status), Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func agentView(v runs.AgentInstance) api.Agent {
	return api.Agent{ID: v.ID, RunID: v.RunID, TaskID: v.TaskID, Profile: v.Profile, Status: string(v.Status), Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func attemptView(v agents.Attempt) api.Attempt {
	return api.Attempt{ID: v.ID, AgentID: v.AgentID, AttemptNo: v.AttemptNo, Status: string(v.Status), StartedAt: v.StartedAt, FinishedAt: v.FinishedAt, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func evidenceView(v evidence.Artifact) api.Evidence {
	return api.Evidence{ID: v.ID, RunID: v.RunID, Kind: string(v.Kind), MIME: v.MIME, Size: v.Size, SHA256: v.SHA256, SchemaVersion: v.SchemaVersion, ParserVersion: v.ParserVersion, Sensitivity: string(v.Sensitivity), ParentID: v.ParentID, RelationshipType: v.RelType, CreatedAt: v.CreatedAt}
}
func findingView(v findings.Finding) api.Finding {
	return api.Finding{ID: v.ID, RunID: v.RunID, Title: v.Title, Description: v.Description, Severity: string(v.Severity), Confidence: string(v.Confidence), Status: string(v.Status), Version: v.Version, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt}
}
func revisionView(v findings.FindingRevision) api.FindingRevision {
	evidence := make([]api.EvidenceRef, len(v.Evidence))
	for i := range v.Evidence {
		evidence[i] = api.EvidenceRef{EvidenceID: v.Evidence[i].EvidenceID, Role: v.Evidence[i].Role}
	}
	return api.FindingRevision{
		FindingID: v.FindingID, RevisionNo: v.RevisionNo, Title: v.Title, Description: v.Description,
		Severity: string(v.Severity), Confidence: string(v.Confidence), Status: string(v.Status),
		ChangeReason: v.ChangeReason, Actor: v.Actor, Evidence: evidence, CreatedAt: v.CreatedAt,
	}
}
func reportView(v reporting.Report) api.Report {
	return api.Report{
		ID: v.ID, RunID: v.RunID, TemplateID: v.Template.ID, TemplateVersion: v.Template.Version,
		TemplateHash: v.Template.Hash, Status: string(v.Status), Version: v.Version,
		OutputArtifactID: v.OutputArtifactID, FailureCode: v.FailureCode, FailureMessage: v.FailureMessage,
		CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt,
	}
}
func reviewDecision(decision string) (findings.FindingStatus, bool) {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case string(findings.StatusReviewed):
		return findings.StatusReviewed, true
	case string(findings.StatusConfirmed):
		return findings.StatusConfirmed, true
	case string(findings.StatusRejected):
		return findings.StatusRejected, true
	case string(findings.StatusInconclusive):
		return findings.StatusInconclusive, true
	default:
		return "", false
	}
}
func findingError(err error) error {
	var lock *findings.ErrOptimisticLock
	var illegal *findings.ErrIllegalTransition
	var notFound *findings.ErrFindingNotFound
	var revision *findings.ErrFindingRevisionNotFound
	switch {
	case errors.As(err, &lock):
		return api.Conflict("the finding was modified by another request")
	case errors.As(err, &illegal):
		return api.Unprocessable(err.Error())
	case errors.As(err, &notFound), errors.As(err, &revision):
		return api.NotFound("finding was not found")
	default:
		return api.BadRequest(err.Error())
	}
}
func unavailable(error) error {
	return &api.Error{Status: 503, Code: "dependency_unavailable", Detail: "a required dependency is unavailable"}
}
func useCaseError(err error) error {
	var conflict *runs.ErrRequestConflict
	var agentConflict *agents.ErrRequestConflict
	var denied *ErrRunUnauthorized
	var noRun *runs.ErrRunNotFound
	var noAgent *runs.ErrAgentNotFound
	var notAccepting *runs.ErrRunNotAcceptingWork
	switch {
	case errors.Is(err, agents.ErrModelUnavailable):
		return unavailable(err)
	case errors.As(err, &conflict), errors.As(err, &agentConflict):
		return api.Conflict("idempotency key was used with a different request")
	case errors.As(err, &denied):
		return api.Forbidden("the request is not authorized")
	case errors.As(err, &noRun), errors.As(err, &noAgent):
		return api.NotFound("resource was not found")
	case errors.As(err, &notAccepting):
		return api.Unprocessable("run does not accept work")
	case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "must not be empty"), strings.Contains(err.Error(), "does not belong"):
		return api.BadRequest(err.Error())
	default:
		return fmt.Errorf("application use case: %w", err)
	}
}
