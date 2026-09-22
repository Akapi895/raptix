package evidence

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/filesystem"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
// It allows multiple artifacts with the same checksum (matching the production
// schema where content-addressable bytes can be shared across runs).
type memRepo struct {
	artifacts map[uuid.UUID]Artifact
	bySHA     map[string]uuid.UUID
	byRun     map[uuid.UUID][]uuid.UUID
	next      int
}

func newMemRepo() *memRepo {
	return &memRepo{
		artifacts: map[uuid.UUID]Artifact{},
		bySHA:     map[string]uuid.UUID{},
		byRun:     map[uuid.UUID][]uuid.UUID{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("evidence-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateArtifact(ctx context.Context, p CreateArtifactParams) (Artifact, error) {
	id := m.newID()
	a := Artifact{
		ID: id, RunID: p.RunID, Kind: p.Kind, MIME: p.MIME, Size: p.Size,
		SHA256: p.SHA256, SchemaVersion: p.SchemaVersion, ParserVersion: p.ParserVersion,
		Sensitivity: p.Sensitivity, StorageKey: p.StorageKey, RelType: p.RelType,
		ParentID: p.ParentID,
	}
	m.artifacts[id] = a
	m.bySHA[a.SHA256] = id
	if a.RunID != nil {
		m.byRun[*a.RunID] = append(m.byRun[*a.RunID], id)
	}
	return a, nil
}

func (m *memRepo) GetArtifact(ctx context.Context, id uuid.UUID) (Artifact, error) {
	a, ok := m.artifacts[id]
	if !ok {
		return Artifact{}, &ErrArtifactNotFound{ID: id}
	}
	return a, nil
}

func (m *memRepo) GetArtifactBySHA256(ctx context.Context, sha string) (Artifact, error) {
	id, ok := m.bySHA[sha]
	if !ok {
		return Artifact{}, &ErrArtifactNotFound{}
	}
	return m.GetArtifact(ctx, id)
}

func (m *memRepo) GetArtifactBySHA256InRun(ctx context.Context, runID uuid.UUID, sha string) (Artifact, error) {
	for _, id := range m.byRun[runID] {
		if a, ok := m.artifacts[id]; ok && a.SHA256 == sha {
			return a, nil
		}
	}
	return Artifact{}, &ErrArtifactNotFound{}
}

func (m *memRepo) ListArtifactsByRun(ctx context.Context, runID uuid.UUID) ([]Artifact, error) {
	out := make([]Artifact, 0, len(m.byRun[runID]))
	for _, id := range m.byRun[runID] {
		out = append(out, m.artifacts[id])
	}
	return out, nil
}

func (m *memRepo) ListDerived(ctx context.Context, parentID uuid.UUID) ([]Artifact, error) {
	out := []Artifact{}
	for _, a := range m.artifacts {
		if a.ParentID != nil && *a.ParentID == parentID {
			out = append(out, a)
		}
	}
	return out, nil
}

// memStore is an in-memory BlobStore backing the unit tests. Rename moves a
// staged copy to its final content-addressed key.
type memStore struct {
	mu sync.Mutex
	m  map[string][]byte
}

func newMemStore() *memStore { return &memStore{m: map[string][]byte{}} }

func (s *memStore) Write(ctx context.Context, key string, r io.Reader) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[key] = b
	return nil
}

func (s *memStore) Read(ctx context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.m[key]
	if !ok {
		return nil, fmt.Errorf("mem store: key %q not found", key)
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s *memStore) Exists(ctx context.Context, key string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.m[key]
	return ok, nil
}

func (s *memStore) Delete(ctx context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, key)
	return nil
}

func (s *memStore) Rename(ctx context.Context, from, to string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.m[from]
	if !ok {
		return fmt.Errorf("mem store: key %q not found", from)
	}
	s.m[to] = b
	delete(s.m, from)
	return nil
}

func TestRegisterComputesChecksumAndSizeFromContent(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	payload := "hello evidence"
	art, err := svc.Register(ctx, RegisterParams{
		Kind: KindRaw, MIME: "text/plain",
	}, strings.NewReader(payload))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	wantHash, _ := NewSHA256(strings.NewReader(payload))
	if art.SHA256 != wantHash || art.Size != int64(len(payload)) {
		t.Errorf("checksum/size = %s/%d, want %s/%d", art.SHA256, art.Size, wantHash, len(payload))
	}
	// The storage key must be content-addressed, not caller-supplied.
	if art.StorageKey != "sha256/"+wantHash {
		t.Errorf("storage key = %q, want sha256/%s", art.StorageKey, wantHash)
	}
	got, err := svc.GetArtifact(ctx, art.ID)
	if err != nil {
		t.Fatalf("get by id: %v", err)
	}
	if got.SHA256 != wantHash {
		t.Errorf("sha = %q", got.SHA256)
	}
}

func TestRegisterPersistsBytesReadableByKey(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	payload := "GET /login HTTP/1.1 200 OK"
	art, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	rc, err := svc.ReadRef(ctx, art)
	if err != nil {
		t.Fatalf("read ref: %v", err)
	}
	defer rc.Close()
	back, _ := io.ReadAll(rc)
	if string(back) != payload {
		t.Fatalf("bytes mismatch: got %q, want %q", string(back), payload)
	}
}

func TestNewSHA256Deterministic(t *testing.T) {
	h1, err := NewSHA256(strings.NewReader("hello evidence"))
	if err != nil {
		t.Fatal(err)
	}
	h2, err := NewSHA256(strings.NewReader("hello evidence"))
	if err != nil {
		t.Fatal(err)
	}
	if h1 != h2 {
		t.Errorf("checksums differ: %q vs %q", h1, h2)
	}
	if len(h1) != 64 || h1 != strings.ToLower(h1) {
		t.Errorf("unexpected checksum %q", h1)
	}
}

func TestRegisterContentAddressedAndDedup(t *testing.T) {
	repo := newMemRepo()
	store := newMemStore()
	svc := NewService(repo, store)
	ctx := context.Background()
	payload := "dedup me"

	a, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	// Same bytes registered twice must share one content-addressed file.
	b, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID {
		t.Fatal("two registrations must produce two distinct artifact rows")
	}
	if a.StorageKey != b.StorageKey {
		t.Fatalf("deduped keys differ: %q vs %q", a.StorageKey, b.StorageKey)
	}
	exists, err := store.Exists(ctx, a.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatalf("content-addressed bytes missing: %q", a.StorageKey)
	}
	// No stray staging copy remains.
	if _, err := store.Read(ctx, stagingPrefix+"x"); err == nil {
		t.Fatal("staging file should not exist")
	}
	// Both metadata rows resolve to the same sharable bytes.
	rc, err := store.Read(ctx, a.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	back, _ := io.ReadAll(rc)
	if string(back) != payload {
		t.Errorf("dedup bytes = %q, want %q", back, payload)
	}
}

func TestRegisterDistinctContentGetsDistinctKeys(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	a, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader("aaa"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader("bbb"))
	if err != nil {
		t.Fatal(err)
	}
	if a.StorageKey == b.StorageKey {
		t.Fatal("distinct content must not share a storage key")
	}
}

func TestDeriveSetsParentAndSharesRun(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	runID := uuid.New()
	raw, err := svc.Register(ctx, RegisterParams{
		RunID: &runID, Kind: KindRaw,
	}, strings.NewReader("raw bytes"))
	if err != nil {
		t.Fatal(err)
	}
	derived, err := svc.Register(ctx, RegisterParams{
		RunID: &runID, Kind: KindDerived, ParentID: &raw.ID, RelType: "parsed",
	}, strings.NewReader("derived bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if derived.ParentID == nil || *derived.ParentID != raw.ID {
		t.Errorf("derived parent = %v, want %v", derived.ParentID, raw.ID)
	}
	if derived.RunID == nil || *derived.RunID != runID {
		t.Errorf("derived run = %v, want run", derived.RunID)
	}
	list, err := svc.repo.ListDerived(ctx, raw.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != derived.ID {
		t.Errorf("derived list = %+v", list)
	}
}

func TestDerivedRejectsCrossRunParent(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	runA := uuid.New()
	runB := uuid.New()
	raw, err := svc.Register(ctx, RegisterParams{
		RunID: &runA, Kind: KindRaw,
	}, strings.NewReader("raw"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Register(ctx, RegisterParams{
		RunID: &runB, Kind: KindDerived, ParentID: &raw.ID, RelType: "parsed",
	}, strings.NewReader("x")); err == nil {
		t.Error("expected cross-run derived error")
	}
}

func TestRegisterRejectsInvalid(t *testing.T) {
	svc := NewService(newMemRepo(), newMemStore())
	ctx := context.Background()
	if _, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Register(ctx, RegisterParams{Kind: Kind("other")}, strings.NewReader("x")); err == nil {
		t.Error("expected invalid-kind error")
	}
	pid := uuid.New()
	if _, err := svc.Register(ctx, RegisterParams{Kind: KindRaw, ParentID: &pid}, strings.NewReader("x")); err == nil {
		t.Error("expected raw-with-parent error")
	}
	if _, err := svc.Register(ctx, RegisterParams{Kind: KindDerived}, strings.NewReader("x")); err == nil {
		t.Error("expected derived-without-parent error")
	}
	if _, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, nil); err == nil {
		t.Error("expected nil-content error")
	}
}

func TestRegisterContentAddressedDedupOnRealStore(t *testing.T) {
	fs, err := filesystem.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer fs.Close()
	svc := NewService(newMemRepo(), fs)
	ctx := context.Background()
	payload := "same bytes"

	a, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.Register(ctx, RegisterParams{Kind: KindRaw}, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if a.StorageKey != b.StorageKey {
		t.Fatalf("dedup on real store failed: %q vs %q", a.StorageKey, b.StorageKey)
	}
	exists, err := fs.Exists(ctx, a.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatalf("content-addressed bytes missing on real store: %q", a.StorageKey)
	}
	// Both artifacts resolve to the same file's bytes.
	rc, err := svc.ReadRef(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	buf, _ := io.ReadAll(rc)
	rc.Close()
	if string(buf) != payload {
		t.Errorf("bytes = %q, want %q", string(buf), payload)
	}
}
