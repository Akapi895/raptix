package reporting

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"text/template"
	"time"

	"github.com/google/uuid"
)

// TemplateDocument is the immutable content needed to render one report.
type TemplateDocument struct {
	Template
	MIME string
	Body string
}

// TemplateResolver resolves a template by its persisted identity. Implementors
// must reject content whose ID, version, or hash does not match the request.
type TemplateResolver interface {
	ResolveReportTemplate(ctx context.Context, id, version string) (TemplateDocument, error)
}

// OutputPublisher publishes rendered Markdown through the public evidence
// service and returns its artifact ID.
type OutputPublisher interface {
	PublishReportOutput(ctx context.Context, report Report, markdown []byte) (uuid.UUID, error)
}

// RenderConfig supplies the rendering-only dependencies for Service.
type RenderConfig struct {
	Templates     TemplateResolver
	Output        OutputPublisher
	LeaseDuration time.Duration
}

// RetryAfterError asks queue infrastructure to retry after the report lease is
// available. It never represents a model or tool replay.
type RetryAfterError struct {
	After time.Duration
	Err   error
}

func (e *RetryAfterError) Error() string { return e.Err.Error() }
func (e *RetryAfterError) Unwrap() error { return e.Err }

// RetryAfter exposes the retry delay to queue adapters without coupling them to
// the reporting package: infrastructure/jobs matches this method structurally.
func (e *RetryAfterError) RetryAfter() time.Duration { return e.After }

var errReportLeaseHeld = errors.New("report render lease is held")

// Render claims a report, renders only its stored snapshot, publishes one
// Markdown artifact, and finalizes it with a compare-and-swap. Terminal reports
// are deliberately no-ops so River redelivery is safe.
func (s *Service) Render(ctx context.Context, id uuid.UUID, worker string) error {
	if id == uuid.Nil {
		return fmt.Errorf("report id is required")
	}
	current, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if current.Status == StatusCompleted || current.Status == StatusCancelled || current.Status == StatusFailed {
		return nil
	}
	if s.templates == nil || s.output == nil {
		return s.failRender(ctx, current, worker, "renderer_unavailable", "report renderer is not configured")
	}
	lease := s.leaseDuration
	if lease <= 0 {
		lease = time.Minute
	}
	claimed, err := s.Claim(ctx, ClaimParams{ID: id, ExpectedVersion: current.Version, Worker: worker, LeaseDuration: lease})
	if err != nil {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			return err
		}
		latest, getErr := s.repo.Get(ctx, id)
		if getErr != nil {
			return getErr
		}
		if latest.Status == StatusRendering && latest.LeaseExpiresAt != nil {
			after := time.Until(*latest.LeaseExpiresAt)
			if after > 0 {
				return &RetryAfterError{After: after, Err: errReportLeaseHeld}
			}
		}
		return nil
	}

	document, err := s.templates.ResolveReportTemplate(ctx, claimed.Template.ID, claimed.Template.Version)
	if err != nil || document.Template != claimed.Template || document.MIME != "text/markdown" {
		return s.failRender(ctx, claimed, worker, "template_unavailable", "the requested report template is unavailable")
	}
	markdown, err := renderMarkdown(document.Body, claimed.Snapshot)
	if err != nil {
		return s.failRender(ctx, claimed, worker, "template_invalid", "the report template cannot render the stored snapshot")
	}
	artifactID, err := s.output.PublishReportOutput(ctx, claimed, markdown)
	if err != nil {
		return &RetryAfterError{After: lease, Err: fmt.Errorf("publish report output: %w", err)}
	}
	_, err = s.Complete(ctx, CompleteParams{ID: claimed.ID, ExpectedVersion: claimed.Version, Worker: worker, OutputArtifactID: artifactID})
	if err == nil {
		return nil
	}
	var lock *ErrOptimisticLock
	if errors.As(err, &lock) {
		latest, getErr := s.repo.Get(ctx, id)
		if getErr == nil && latest.Status == StatusCompleted {
			return nil
		}
		return &RetryAfterError{After: lease, Err: err}
	}
	return err
}

func (s *Service) failRender(ctx context.Context, report Report, worker, code, message string) error {
	_, err := s.Fail(ctx, FailParams{ID: report.ID, ExpectedVersion: report.Version, Worker: worker, Code: code, Message: message})
	if err == nil {
		return nil
	}
	var lock *ErrOptimisticLock
	if errors.As(err, &lock) {
		return nil
	}
	return err
}

func renderMarkdown(body string, snapshot json.RawMessage) ([]byte, error) {
	// Decoding to maps/slices limits templates to inert JSON values. No custom
	// functions are registered, so templates cannot access files, network, or a shell.
	var data map[string]any
	if err := json.Unmarshal(snapshot, &data); err != nil || data == nil {
		return nil, fmt.Errorf("decode report snapshot")
	}
	tmpl, err := template.New("report").Option("missingkey=error").Parse(body)
	if err != nil {
		return nil, err
	}
	var rendered bytes.Buffer
	if err := tmpl.Execute(&rendered, data); err != nil {
		return nil, err
	}
	return rendered.Bytes(), nil
}
