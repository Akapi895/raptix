// Package artifact standardizes how capabilities persist raw and derived output
// through workspace/evidence. It owns provenance shape (kind, parent, relation,
// parser version) but never stores bytes itself and never writes to the database
// directly: all writes go through the injected EvidenceWriter, which is the
// workspace/evidence service. This keeps evidence ownership in one place while
// giving command capabilities a small, uniform write surface.
package artifact

import (
	"context"
	"io"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

// EvidenceWriter records artifact bytes. Implemented by workspace/evidence.
type EvidenceWriter interface {
	Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error)
}

// Writer writes raw and derived artifacts with consistent provenance.
type Writer struct {
	w EvidenceWriter
}

// NewWriter wraps an evidence writer.
func NewWriter(w EvidenceWriter) *Writer { return &Writer{w: w} }

// WriteRaw records raw capability output (e.g. command stdout) as a raw
// artifact scoped to a run.
func (a *Writer) WriteRaw(ctx context.Context, runID *uuid.UUID, mime, schemaVersion string, r io.Reader) (evidence.Artifact, error) {
	return a.w.Register(ctx, evidence.RegisterParams{
		RunID:         runID,
		Kind:          evidence.KindRaw,
		MIME:          normalizeMIME(mime),
		Sensitivity:   evidence.SensitivityLow,
		SchemaVersion: schemaVersion,
	}, r)
}

// WriteDerived records a parsed artifact linked to its raw parent. The relation
// type and parser version are required so downstream review can trace exactly
// which parser produced the derived bytes.
func (a *Writer) WriteDerived(ctx context.Context, runID *uuid.UUID, parent uuid.UUID, mime, schemaVersion, parserVersion, relType string, r io.Reader) (evidence.Artifact, error) {
	if parent == uuid.Nil {
		return evidence.Artifact{}, errString("derived artifact requires a parent")
	}
	if strings.TrimSpace(relType) == "" {
		return evidence.Artifact{}, errString("derived artifact requires a relation type")
	}
	return a.w.Register(ctx, evidence.RegisterParams{
		RunID:         runID,
		Kind:          evidence.KindDerived,
		MIME:          normalizeMIME(mime),
		Sensitivity:   evidence.SensitivityLow,
		SchemaVersion: schemaVersion,
		ParserVersion: parserVersion,
		RelType:       relType,
		ParentID:      &parent,
	}, r)
}

func normalizeMIME(mime string) string {
	if strings.TrimSpace(mime) == "" {
		return "application/octet-stream"
	}
	return mime
}

type errString string

func (e errString) Error() string { return string(e) }
