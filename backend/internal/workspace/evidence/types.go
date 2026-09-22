// Package evidence owns artifact metadata, provenance and checksum. Bytes live
// in a separate storage adapter; this module only persists metadata. Owner:
// workspace/evidence.
package evidence

import (
	"time"

	"github.com/google/uuid"
)

// Kind is the category of an artifact.
type Kind string

const (
	// KindRaw is a raw artifact captured from the target (provenance).
	KindRaw Kind = "raw"
	// KindDerived is an artifact derived from another artifact.
	KindDerived Kind = "derived"
)

// Sensitivity is a data classification for an artifact.
type Sensitivity string

const (
	// SensitivityLow is non-sensitive data.
	SensitivityLow Sensitivity = "low"
	// SensitivityMedium is moderately sensitive data.
	SensitivityMedium Sensitivity = "medium"
	// SensitivityHigh is highly sensitive data.
	SensitivityHigh Sensitivity = "high"
	// SensitivitySecret is secret data (credentials, keys).
	SensitivitySecret Sensitivity = "secret"
)

// Artifact is artifact metadata and provenance. The payload bytes live in a
// storage adapter addressed by StorageKey.
type Artifact struct {
	ID            uuid.UUID
	RunID         *uuid.UUID
	Kind          Kind
	MIME          string
	Size          int64
	SHA256        string
	SchemaVersion string
	ParserVersion string
	Sensitivity   Sensitivity
	StorageKey    string
	RelType       string
	ParentID      *uuid.UUID
	CreatedAt     time.Time
}

// CreateArtifactParams carries the fields for registering an artifact.
type CreateArtifactParams struct {
	RunID         *uuid.UUID
	Kind          Kind
	MIME          string
	Size          int64
	SHA256        string
	SchemaVersion string
	ParserVersion string
	Sensitivity   Sensitivity
	StorageKey    string
	RelType       string
	ParentID      *uuid.UUID
}

// ErrArtifactNotFound reports a missing artifact.
type ErrArtifactNotFound struct{ ID uuid.UUID }

func (e *ErrArtifactNotFound) Error() string { return "artifact not found: " + e.ID.String() }
