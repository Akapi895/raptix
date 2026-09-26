package api

import (
	"context"
	"io"
	"time"

	"github.com/google/uuid"
)

// Principal is derived only by an Authenticator. HTTP handlers never accept it
// from request data or headers other than the verified bearer token.
type Principal struct{ Subject string }

type Project struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Scope struct {
	ID           uuid.UUID  `json:"id"`
	ProjectID    uuid.UUID  `json:"projectId"`
	Version      int        `json:"version"`
	AssetTypes   []string   `json:"assetTypes"`
	Include      []string   `json:"include"`
	Exclude      []string   `json:"exclude"`
	ExpiresAt    *time.Time `json:"expiresAt"`
	ApprovalNote *string    `json:"approvalNote,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}
type Run struct {
	ID        uuid.UUID `json:"id"`
	ProjectID uuid.UUID `json:"projectId"`
	ScopeID   uuid.UUID `json:"scopeId"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Task struct {
	ID        uuid.UUID `json:"id"`
	RunID     uuid.UUID `json:"runId"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Agent struct {
	ID        uuid.UUID  `json:"id"`
	RunID     uuid.UUID  `json:"runId"`
	TaskID    *uuid.UUID `json:"taskId"`
	Profile   string     `json:"profile"`
	Status    string     `json:"status"`
	Version   int        `json:"version"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}
type Attempt struct {
	ID         uuid.UUID  `json:"id"`
	AgentID    uuid.UUID  `json:"agentId"`
	AttemptNo  int        `json:"attemptNo"`
	Status     string     `json:"status"`
	StartedAt  *time.Time `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// Evidence deliberately has no storage key. Artifact locations and credentials
// are infrastructure details and must never cross the HTTP boundary.
type Evidence struct {
	ID               uuid.UUID  `json:"id"`
	RunID            *uuid.UUID `json:"runId"`
	Kind             string     `json:"kind"`
	MIME             string     `json:"mime"`
	Size             int64      `json:"size"`
	SHA256           string     `json:"sha256"`
	SchemaVersion    string     `json:"schemaVersion"`
	ParserVersion    string     `json:"parserVersion"`
	Sensitivity      string     `json:"sensitivity"`
	ParentID         *uuid.UUID `json:"parentId"`
	RelationshipType string     `json:"relationshipType"`
	CreatedAt        time.Time  `json:"createdAt"`
}
type Finding struct {
	ID          uuid.UUID `json:"id"`
	RunID       uuid.UUID `json:"runId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Severity    string    `json:"severity"`
	Confidence  string    `json:"confidence"`
	Status      string    `json:"status"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// EvidenceRef is one evidence membership in an immutable finding revision.
type EvidenceRef struct {
	EvidenceID uuid.UUID `json:"evidenceId"`
	Role       string    `json:"role"`
}

// FindingRevision is an immutable content, status and evidence snapshot.
type FindingRevision struct {
	FindingID    uuid.UUID     `json:"findingId"`
	RevisionNo   int           `json:"revisionNo"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	Severity     string        `json:"severity"`
	Confidence   string        `json:"confidence"`
	Status       string        `json:"status"`
	ChangeReason string        `json:"changeReason"`
	Actor        string        `json:"actor"`
	Evidence     []EvidenceRef `json:"evidence"`
	CreatedAt    time.Time     `json:"createdAt"`
}

// Report is the immutable report request and its publication lifecycle.
type Report struct {
	ID               uuid.UUID  `json:"id"`
	RunID            uuid.UUID  `json:"runId"`
	TemplateID       string     `json:"templateId"`
	TemplateVersion  string     `json:"templateVersion"`
	TemplateHash     string     `json:"templateHash"`
	Status           string     `json:"status"`
	Version          int        `json:"version"`
	OutputArtifactID *uuid.UUID `json:"outputArtifactId,omitempty"`
	FailureCode      string     `json:"failureCode,omitempty"`
	FailureMessage   string     `json:"failureMessage,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type AttemptResult struct {
	Attempt   Attempt    `json:"attempt"`
	Summary   string     `json:"summary"`
	FindingID *uuid.UUID `json:"findingId"`
	VerdictID *uuid.UUID `json:"verdictId"`
}
type RunSnapshot struct {
	Run    Run     `json:"run"`
	Tasks  []Task  `json:"tasks"`
	Agents []Agent `json:"agents"`
}

// UseCases is the public, authorized application boundary used by HTTP. It
// intentionally returns transport-safe views, not module stores or entities.
type UseCases interface {
	ListProjects(context.Context, Principal) ([]Project, error)
	GetProject(context.Context, Principal, uuid.UUID) (Project, error)
	ListScopes(context.Context, Principal, uuid.UUID) ([]Scope, error)
	ListRuns(context.Context, Principal, uuid.UUID) ([]Run, error)
	CreateRun(context.Context, Principal, uuid.UUID, uuid.UUID, string, string) (Run, error)
	GetRun(context.Context, Principal, uuid.UUID) (Run, error)
	ListTasks(context.Context, Principal, uuid.UUID) ([]Task, error)
	ListAgents(context.Context, Principal, uuid.UUID) ([]Agent, error)
	CreateAgent(context.Context, Principal, uuid.UUID, *uuid.UUID, string, string) (Agent, error)
	RunAgentAttempt(context.Context, Principal, uuid.UUID, string, string) (AttemptResult, error)
	CancelRun(context.Context, Principal, uuid.UUID) (Run, error)
	ListEvidence(context.Context, Principal, uuid.UUID) ([]Evidence, error)
	GetEvidence(context.Context, Principal, uuid.UUID) (Evidence, error)
	OpenEvidence(context.Context, Principal, uuid.UUID) (Evidence, io.ReadCloser, error)
	ListFindings(context.Context, Principal, uuid.UUID) ([]Finding, error)
	GetFinding(context.Context, Principal, uuid.UUID) (Finding, error)
	ListFindingRevisions(context.Context, Principal, uuid.UUID) ([]FindingRevision, error)
	ReviseFinding(context.Context, Principal, uuid.UUID, int, ReviseFindingInput) (Finding, error)
	ReviewFinding(context.Context, Principal, uuid.UUID, int, string, string) (Finding, error)
	CreateReport(context.Context, Principal, uuid.UUID, string, string, string) (Report, error)
	GetReport(context.Context, Principal, uuid.UUID) (Report, error)
	OpenReportContent(context.Context, Principal, uuid.UUID) (Report, io.ReadCloser, error)
	Snapshot(context.Context, Principal, uuid.UUID) (RunSnapshot, error)
}

// ReviseFindingInput carries the new content and complete evidence set for a
// finding revision.
type ReviseFindingInput struct {
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Severity    string        `json:"severity"`
	Confidence  string        `json:"confidence"`
	Evidence    []EvidenceRef `json:"evidence"`
	Reason      string        `json:"reason"`
}

type Error struct {
	Status       int
	Code, Detail string
}

func (e *Error) Error() string { return e.Detail }
func BadRequest(detail string) error {
	return &Error{Status: 400, Code: "invalid_request", Detail: detail}
}
func Unauthorized(detail string) error {
	return &Error{Status: 401, Code: "unauthenticated", Detail: detail}
}
func Forbidden(detail string) error { return &Error{Status: 403, Code: "forbidden", Detail: detail} }
func NotFound(detail string) error  { return &Error{Status: 404, Code: "not_found", Detail: detail} }
func Conflict(detail string) error  { return &Error{Status: 409, Code: "conflict", Detail: detail} }
func Unprocessable(detail string) error {
	return &Error{Status: 422, Code: "invalid_transition", Detail: detail}
}
