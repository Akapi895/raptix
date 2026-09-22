package evidence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// BlobStore is the storage-adapter contract for artifact bytes. It is
// implemented by infrastructure/database/filesystem and injected by the
// composition root; evidence never assumes a particular backend.
type BlobStore interface {
	Write(ctx context.Context, key string, r io.Reader) error
	Read(ctx context.Context, key string) (io.ReadCloser, error)
	Exists(ctx context.Context, key string) (bool, error)
	Delete(ctx context.Context, key string) error
	Rename(ctx context.Context, from, to string) error
}

// stagingPrefix holds in-flight copies before they are promoted to their final
// content-addressed key. A crashed process may leave stale staging files here;
// they are inert and can be reaped by background cleanup.
const stagingPrefix = "pending/"

// contentPrefix prefixes content-addressed keys.
const contentPrefix = "sha256/"

// Service exposes artifact registration and lookup with business rules enforced
// here. Bytes always travel through the BlobStore, and storage keys are
// content-addressed: the key is derived from the artifact's SHA-256, so two
// artifacts with identical bytes share one immutable copy (safe deduplication)
// and distinct bytes can never collide or overwrite each other.
type Service struct {
	repo  Repository
	store BlobStore
}

// NewService wires an evidence service over a repository and the blob store
// that holds artifact bytes.
func NewService(repo Repository, store BlobStore) *Service {
	return &Service{repo: repo, store: store}
}

var sha256Re = regexp.MustCompile(`^[0-9a-f]{64}$`)

// RegisterParams describes an artifact before its bytes are supplied. The
// final storage key is not caller-supplied: it is derived from the content.
type RegisterParams struct {
	RunID         *uuid.UUID
	Kind          Kind
	MIME          string
	Sensitivity   Sensitivity
	SchemaVersion string
	ParserVersion string
	RelType       string
	ParentID      *uuid.UUID
}

// Register stores content at a content-addressed key, verifies it by reading it
// back, then records metadata with the checksum and size derived from those
// bytes. Metadata is only ever written after its bytes exist, so a record can
// never describe content that was never stored.
func (s *Service) Register(ctx context.Context, p RegisterParams, content io.Reader) (Artifact, error) {
	if s.store == nil {
		return Artifact{}, fmt.Errorf("evidence blob store is not wired")
	}
	if content == nil {
		return Artifact{}, fmt.Errorf("artifact content is required")
	}
	if err := validateRegisterParams(ctx, s.repo, &p); err != nil {
		return Artifact{}, err
	}

	// Write to a unique staging key, hashing the bytes as they flow through so
	// the checksum and size come from the actual content, never the caller.
	stagingKey := stagingPrefix + uuid.NewString()
	hash := sha256.New()
	counter := &countingReader{r: content}
	if err := s.store.Write(ctx, stagingKey, io.TeeReader(counter, hash)); err != nil {
		return Artifact{}, fmt.Errorf("store artifact bytes: %w", err)
	}
	sha := hex.EncodeToString(hash.Sum(nil))
	size := counter.n

	// Read the staging copy back before trusting it: a store that silently
	// truncated or corrupted the write must not produce metadata that lies.
	if err := s.verifyKey(ctx, stagingKey, sha, size); err != nil {
		_ = s.store.Delete(ctx, stagingKey)
		return Artifact{}, err
	}

	// Promote to the content-addressed key. If bytes with this checksum are
	// already stored, drop our staging copy and reuse the existing one.
	finalKey := contentPrefix + sha
	exists, err := s.store.Exists(ctx, finalKey)
	if err != nil {
		_ = s.store.Delete(ctx, stagingKey)
		return Artifact{}, fmt.Errorf("check artifact key: %w", err)
	}
	if exists {
		_ = s.store.Delete(ctx, stagingKey)
	} else if err := s.store.Rename(ctx, stagingKey, finalKey); err != nil {
		_ = s.store.Delete(ctx, stagingKey)
		return Artifact{}, fmt.Errorf("promote artifact bytes: %w", err)
	}

	created, err := s.repo.CreateArtifact(ctx, CreateArtifactParams{
		RunID:         p.RunID,
		Kind:          p.Kind,
		MIME:          p.MIME,
		Size:          size,
		SHA256:        sha,
		SchemaVersion: p.SchemaVersion,
		ParserVersion: p.ParserVersion,
		Sensitivity:   p.Sensitivity,
		StorageKey:    finalKey,
		RelType:       p.RelType,
		ParentID:      p.ParentID,
	})
	if err != nil {
		// Deliberately do NOT delete finalKey: it is content-addressed and may
		// already be shared by another artifact. A leftover file with no
		// metadata row is an inert orphan, cleaned up by background reaping.
		return Artifact{}, fmt.Errorf("persist artifact metadata: %w", err)
	}
	return created, nil
}

// verifyKey reads stored bytes back and confirms they match the expected
// checksum and size.
func (s *Service) verifyKey(ctx context.Context, key, wantSHA string, wantSize int64) error {
	rc, err := s.store.Read(ctx, key)
	if err != nil {
		return fmt.Errorf("verify stored artifact: %w", err)
	}
	hash := sha256.New()
	n, err := io.Copy(hash, rc)
	_ = rc.Close()
	if err != nil {
		return fmt.Errorf("verify stored artifact: %w", err)
	}
	if hex.EncodeToString(hash.Sum(nil)) != wantSHA || n != wantSize {
		return fmt.Errorf("stored artifact does not match its checksum")
	}
	return nil
}

// validateRegisterParams enforces kind/sensitivity/provenance invariants.
func validateRegisterParams(ctx context.Context, repo Repository, p *RegisterParams) error {
	switch p.Kind {
	case KindRaw, KindDerived:
	default:
		return fmt.Errorf("invalid artifact kind %q", p.Kind)
	}
	if p.Sensitivity == "" {
		p.Sensitivity = SensitivityLow
	}
	switch p.Sensitivity {
	case SensitivityLow, SensitivityMedium, SensitivityHigh, SensitivitySecret:
	default:
		return fmt.Errorf("invalid sensitivity %q", p.Sensitivity)
	}
	if p.MIME == "" {
		p.MIME = "application/octet-stream"
	}
	if p.Kind == KindDerived {
		if p.ParentID == nil || *p.ParentID == uuid.Nil {
			return fmt.Errorf("derived artifact requires a parent")
		}
		if strings.TrimSpace(p.RelType) == "" {
			return fmt.Errorf("derived artifact requires a relation type")
		}
		parent, err := repo.GetArtifact(ctx, *p.ParentID)
		if err != nil {
			return fmt.Errorf("resolve artifact parent: %w", err)
		}
		// Provenance must stay inside one run when both sides are run-scoped.
		if p.RunID != nil && parent.RunID != nil && *p.RunID != *parent.RunID {
			return fmt.Errorf("derived artifact must belong to the same run as its parent")
		}
		if p.RunID == nil {
			p.RunID = parent.RunID
		}
	} else if p.ParentID != nil {
		return fmt.Errorf("raw artifact must not have a parent")
	} else if strings.TrimSpace(p.RelType) != "" {
		return fmt.Errorf("raw artifact must not have a relation type")
	}
	return nil
}

// countingReader counts the bytes actually read so size comes from content,
// never from caller-supplied metadata.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// GetArtifact returns an artifact by id or a typed not-found error.
func (s *Service) GetArtifact(ctx context.Context, id uuid.UUID) (Artifact, error) {
	return s.repo.GetArtifact(ctx, id)
}

// ReadRef opens the stored bytes for an artifact.
func (s *Service) ReadRef(ctx context.Context, a Artifact) (io.ReadCloser, error) {
	if s.store == nil {
		return nil, fmt.Errorf("evidence blob store is not wired")
	}
	return s.store.Read(ctx, a.StorageKey)
}

// GetBySHA256 returns the newest artifact with a checksum (content-addressed).
func (s *Service) GetBySHA256(ctx context.Context, sha string) (Artifact, error) {
	return s.repo.GetArtifactBySHA256(ctx, strings.ToLower(sha))
}

// GetBySHA256InRun returns the artifact with a checksum inside a specific run.
// Identical bytes can recur across runs, so call sites that know the run should
// use this to get an unambiguous answer.
func (s *Service) GetBySHA256InRun(ctx context.Context, runID uuid.UUID, sha string) (Artifact, error) {
	return s.repo.GetArtifactBySHA256InRun(ctx, runID, strings.ToLower(sha))
}

// ListByRun returns all artifacts for a run.
func (s *Service) ListByRun(ctx context.Context, runID uuid.UUID) ([]Artifact, error) {
	return s.repo.ListArtifactsByRun(ctx, runID)
}

// NewSHA256 computes a lowercase hex sha256 checksum of the reader content.
func NewSHA256(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// IsValidSHA256 reports whether s is a lowercase 64-char hex checksum.
func IsValidSHA256(s string) bool {
	return sha256Re.MatchString(s)
}
