package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
	"github.com/Akapi895/raptix/backend/internal/workspace/reporting"
)

// ReportEnqueuer durably enqueues a report render job. It is implemented by the
// infrastructure/jobs adapter; reporting never depends on the queue directly.
type ReportEnqueuer interface {
	EnqueueReportRender(ctx context.Context, reportID uuid.UUID) error
}

// txReportEnqueuer is the optional transactional variant. When the queue
// adapter supports it, the report request, its immutable snapshot and the River
// job commit in one short PostgreSQL transaction so a committed report always
// has a job (and a failed enqueue rolls the report back).
type txReportEnqueuer interface {
	EnqueueReportRenderTx(ctx context.Context, tx pgx.Tx, reportID uuid.UUID) error
}

// reportInputs builds the immutable JSON snapshot for one run by composing the
// public read contracts of runs, findings and evidence. It lives in app because
// composing modules is a cross-module concern; reporting only sees bytes.
type reportInputs struct {
	services *Services
}

func (r *reportInputs) SnapshotReportInputs(ctx context.Context, runID uuid.UUID) (json.RawMessage, error) {
	run, err := r.services.Runs.GetRun(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("read run for report: %w", err)
	}
	runFindings, err := r.services.Findings.ListFindingsByRun(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("read findings for report: %w", err)
	}
	snapshot := reportSnapshot{
		Run:      reportRun{RunID: run.ID, Name: run.Name, Status: string(run.Status), ProjectID: run.ProjectID, ScopeID: run.ScopeID},
		Findings: make([]reportFinding, 0, len(runFindings)),
	}
	for _, finding := range runFindings {
		input, err := r.services.Findings.GetReportInput(ctx, finding.ID)
		if err != nil {
			return nil, fmt.Errorf("read finding revision for report: %w", err)
		}
		entry := reportFinding{
			FindingID:  finding.ID,
			RevisionNo: input.Revision.RevisionNo,
			Revision: reportRevision{
				Title: input.Revision.Title, Description: input.Revision.Description,
				Severity: string(input.Revision.Severity), Confidence: string(input.Revision.Confidence),
				Status: string(input.Revision.Status),
			},
			Evidence: make([]reportEvidence, 0, len(input.Revision.Evidence)),
			Verdicts: make([]reportVerdict, 0, len(input.Verdicts)),
		}
		for _, ref := range input.Revision.Evidence {
			artifact, err := r.services.Evidence.GetArtifact(ctx, ref.EvidenceID)
			if err != nil {
				return nil, fmt.Errorf("read finding evidence for report: %w", err)
			}
			entry.Evidence = append(entry.Evidence, reportEvidence{
				EvidenceID: artifact.ID, Role: ref.Role, MIME: artifact.MIME,
				SHA256: artifact.SHA256, Size: artifact.Size, Sensitivity: string(artifact.Sensitivity),
			})
		}
		for _, verdict := range input.Verdicts {
			entry.Verdicts = append(entry.Verdicts, reportVerdict{
				Verdict: string(verdict.Verdict), Reason: verdict.Reason, ProducedBy: verdict.ProducedBy,
			})
		}
		snapshot.Findings = append(snapshot.Findings, entry)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("encode report snapshot: %w", err)
	}
	return encoded, nil
}

type reportSnapshot struct {
	Run      reportRun       `json:"run"`
	Findings []reportFinding `json:"findings"`
}

type reportRun struct {
	RunID     uuid.UUID `json:"runId"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	ProjectID uuid.UUID `json:"projectId"`
	ScopeID   uuid.UUID `json:"scopeId"`
}

type reportFinding struct {
	FindingID  uuid.UUID        `json:"findingId"`
	RevisionNo int              `json:"revisionNo"`
	Revision   reportRevision   `json:"revision"`
	Evidence   []reportEvidence `json:"evidence"`
	Verdicts   []reportVerdict  `json:"verdicts"`
}

type reportRevision struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	Confidence  string `json:"confidence"`
	Status      string `json:"status"`
}

type reportEvidence struct {
	EvidenceID  uuid.UUID `json:"evidenceId"`
	Role        string    `json:"role"`
	MIME        string    `json:"mime"`
	SHA256      string    `json:"sha256"`
	Size        int64     `json:"size"`
	Sensitivity string    `json:"sensitivity"`
}

type reportVerdict struct {
	Verdict    string `json:"verdict"`
	Reason     string `json:"reason"`
	ProducedBy string `json:"producedBy"`
}

// reportOutput publishes a rendered report as a run-scoped evidence artifact
// and validates an existing artifact before a report links it. Report bytes are
// generated content, so they are stored as a raw artifact; the immutable input
// snapshot lives in the report_requests row and the template revision is carried
// in schema/parser version. Evidence's derived-artifact rule requires a parent
// artifact, which a run-level report does not have.
type reportOutput struct {
	services *Services
}

func (o *reportOutput) PublishReportOutput(ctx context.Context, report reporting.Report, markdown []byte) (uuid.UUID, error) {
	artifact, err := o.services.Evidence.Register(ctx, evidence.RegisterParams{
		RunID:         &report.RunID,
		Kind:          evidence.KindRaw,
		MIME:          "text/markdown",
		Sensitivity:   evidence.SensitivityLow,
		SchemaVersion: "report/" + report.Template.ID,
		ParserVersion: report.Template.Version,
	}, strings.NewReader(string(markdown)))
	if err != nil {
		return uuid.Nil, fmt.Errorf("publish report artifact: %w", err)
	}
	return artifact.ID, nil
}

func (o *reportOutput) ValidateReportOutput(ctx context.Context, runID, artifactID uuid.UUID) error {
	artifact, err := o.services.Evidence.GetArtifact(ctx, artifactID)
	if err != nil {
		return fmt.Errorf("report output artifact is unavailable: %w", err)
	}
	if artifact.RunID == nil || *artifact.RunID != runID {
		return fmt.Errorf("report output artifact does not belong to the report run")
	}
	return nil
}

// reportTemplates resolves declarative report templates from the content root.
// It verifies the stored ID/version/hash so a report always renders the exact
// template revision it was requested with.
type reportTemplates struct {
	loader *content.Loader
}

func (t *reportTemplates) ResolveReportTemplate(ctx context.Context, id, version string) (reporting.TemplateDocument, error) {
	if t.loader == nil {
		return reporting.TemplateDocument{}, fmt.Errorf("content loader is not configured")
	}
	loaded, err := t.loader.LoadReportTemplate(id)
	if err != nil {
		return reporting.TemplateDocument{}, err
	}
	if loaded.ID != id || loaded.Version != version {
		return reporting.TemplateDocument{}, fmt.Errorf("report template %s@%s is unavailable", id, version)
	}
	return reporting.TemplateDocument{
		Template: reporting.Template{ID: loaded.ID, Version: loaded.Version, Hash: loaded.Hash},
		MIME:     loaded.MIME,
		Body:     loaded.Body,
	}, nil
}

// ResolveReportTemplateByHash is used by the API to pin the exact content hash
// when a caller requests a template by id/version.
func (t *reportTemplates) ResolveReportTemplateByHash(id, version string) (reporting.Template, error) {
	document, err := t.ResolveReportTemplate(context.Background(), id, version)
	if err != nil {
		return reporting.Template{}, err
	}
	return document.Template, nil
}

// reportRequestParams is the authorized, transport-safe request to create a
// report for a run.
type reportRequestParams struct {
	RunID           uuid.UUID
	TemplateID      string
	TemplateVersion string
}

// CreateAuthorizedReport resolves the template revision, captures the immutable
// snapshot, creates the single report request for the run, and enqueues its
// render job when the request is newly created.
func (s *Services) CreateAuthorizedReport(ctx context.Context, p reportRequestParams) (reporting.Report, error) {
	if s.Reporting == nil {
		return reporting.Report{}, fmt.Errorf("reporting is not wired")
	}
	if s.reportTemplates == nil {
		return reporting.Report{}, fmt.Errorf("report templates are not wired")
	}
	template, err := s.reportTemplates.ResolveReportTemplateByHash(strings.TrimSpace(p.TemplateID), strings.TrimSpace(p.TemplateVersion))
	if err != nil {
		return reporting.Report{}, err
	}
	params := reporting.RequestParams{RunID: p.RunID, Template: template}

	// Preferred path: one transaction covering the report request, its snapshot
	// and the River job, so a committed report always has a render job.
	if txEnqueuer, ok := s.reportJobs.(txReportEnqueuer); ok && s.pool != nil {
		var out reporting.Report
		err := s.pool.TxFunc(ctx, func(ctx context.Context, tx pgx.Tx) error {
			txService := reporting.NewService(reporting.NewPostgres(tx), s.reportInputs, s.reportOutput, s.reportRenderConfig)
			report, err := txService.Request(ctx, params)
			if err != nil {
				return err
			}
			out = report
			return txEnqueuer.EnqueueReportRenderTx(ctx, tx, report.ID)
		})
		if err != nil {
			return reporting.Report{}, err
		}
		return out, nil
	}

	report, err := s.Reporting.RequestAndEnqueue(ctx, params, func(ctx context.Context, report reporting.Report) error {
		if s.reportJobs == nil {
			return nil
		}
		return s.reportJobs.EnqueueReportRender(ctx, report.ID)
	})
	if err != nil {
		return reporting.Report{}, err
	}
	return report, nil
}

// OpenAuthorizedReportContent returns the published artifact metadata and bytes
// for a completed report. Callers authorize report.read first.
func (s *Services) OpenAuthorizedReportContent(ctx context.Context, reportID uuid.UUID) (evidence.Artifact, io.ReadCloser, error) {
	report, err := s.Reporting.Get(ctx, reportID)
	if err != nil {
		return evidence.Artifact{}, nil, err
	}
	if report.OutputArtifactID == nil {
		return evidence.Artifact{}, nil, fmt.Errorf("report has no published output yet")
	}
	artifact, err := s.Evidence.GetArtifact(ctx, *report.OutputArtifactID)
	if err != nil {
		return evidence.Artifact{}, nil, err
	}
	reader, err := s.Evidence.ReadRef(ctx, artifact)
	if err != nil {
		return evidence.Artifact{}, nil, err
	}
	return artifact, reader, nil
}

// StartPeriodicReconcile runs Reconcile on a fixed interval until ctx is done.
// It is a server-owned scheduler: it calls only the public use case and never
// queries invocation tables directly. A failed pass is logged and retried on the
// next tick rather than spawning additional goroutines.
func (s *Services) StartPeriodicReconcile(ctx context.Context, interval time.Duration, log interface {
	Warn(string, ...any)
}) {
	if interval <= 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.Reconcile(ctx); err != nil {
					log.Warn("periodic reconcile failed", "error", err)
				}
			}
		}
	}()
}

var _ reporting.InputSnapshotter = (*reportInputs)(nil)
var _ reporting.OutputEvidence = (*reportOutput)(nil)
var _ reporting.OutputPublisher = (*reportOutput)(nil)
var _ reporting.TemplateResolver = (*reportTemplates)(nil)
var _ = findings.VerdictConfirmed
