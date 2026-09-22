package artifact

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

type fakeEvidence struct {
	got  evidence.RegisterParams
	body string
}

func (f *fakeEvidence) Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error) {
	b, _ := io.ReadAll(r)
	f.got = p
	f.body = string(b)
	return evidence.Artifact{ID: uuid.New()}, nil
}

func TestWriteRawHasNoParentOrRelation(t *testing.T) {
	f := &fakeEvidence{}
	w := NewWriter(f)
	runID := uuid.New()
	art, err := w.WriteRaw(context.Background(), &runID, "", "stdout/1.0", strings.NewReader("hello"))
	if err != nil {
		t.Fatal(err)
	}
	if art.ID == uuid.Nil {
		t.Error("expected artifact id")
	}
	if f.got.Kind != evidence.KindRaw {
		t.Errorf("kind = %s, want raw", f.got.Kind)
	}
	if f.got.ParentID != nil || f.got.RelType != "" {
		t.Errorf("raw artifact must not carry parent/relation: %+v", f.got)
	}
	if f.got.MIME != "application/octet-stream" {
		t.Errorf("mime = %q, want default", f.got.MIME)
	}
	if f.body != "hello" {
		t.Errorf("body = %q", f.body)
	}
}

func TestWriteDerivedSetsProvenance(t *testing.T) {
	f := &fakeEvidence{}
	w := NewWriter(f)
	parent := uuid.New()
	_, err := w.WriteDerived(context.Background(), nil, parent, "application/json", "nmap/1.0", "nmap-xml/1.0", "parsed", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	if f.got.Kind != evidence.KindDerived {
		t.Errorf("kind = %s, want derived", f.got.Kind)
	}
	if f.got.ParentID == nil || *f.got.ParentID != parent {
		t.Errorf("parent = %v, want %v", f.got.ParentID, parent)
	}
	if f.got.RelType != "parsed" || f.got.ParserVersion != "nmap-xml/1.0" {
		t.Errorf("provenance = %+v", f.got)
	}
}

func TestWriteDerivedRequiresParentAndRelation(t *testing.T) {
	w := NewWriter(&fakeEvidence{})
	if _, err := w.WriteDerived(context.Background(), nil, uuid.Nil, "text/plain", "", "", "parsed", strings.NewReader("")); err == nil {
		t.Error("expected error for nil parent")
	}
	if _, err := w.WriteDerived(context.Background(), nil, uuid.New(), "text/plain", "", "", "", strings.NewReader("")); err == nil {
		t.Error("expected error for empty relation type")
	}
}
