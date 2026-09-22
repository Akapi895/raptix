package filesystem

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteReadDelete(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()
	ctx := context.Background()

	if err := s.Write(ctx, "a/b/c.txt", strings.NewReader("hello")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	out, err := s.Read(ctx, "a/b/c.txt")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(out); err != nil {
		t.Fatalf("read content: %v", err)
	}
	out.Close()
	if buf.String() != "hello" {
		t.Errorf("content = %q, want hello", buf.String())
	}
	if err := s.Delete(ctx, "a/b/c.txt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	exists, err := s.Exists(ctx, "a/b/c.txt")
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if exists {
		t.Error("file should be deleted")
	}
}

func TestWriteOverwritesExisting(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	if err := s.Write(ctx, "k", strings.NewReader("one")); err != nil {
		t.Fatal(err)
	}
	if err := s.Write(ctx, "k", strings.NewReader("two")); err != nil {
		t.Fatal(err)
	}
	out, err := s.Read(ctx, "k")
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(out); err != nil {
		t.Fatal(err)
	}
	if buf.String() != "two" {
		t.Errorf("overwrite content = %q, want two", buf.String())
	}
}

func TestInvalidKeys(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	for _, key := range []string{"", "/abs", "a/../b", "a/./b", ".."} {
		if err := s.Write(ctx, key, strings.NewReader("x")); err == nil {
			t.Errorf("Write(%q): expected error", key)
		}
		if _, err := s.Read(ctx, key); err == nil {
			t.Errorf("Read(%q): expected error", key)
		}
	}
}

func TestSymlinkCannotEscapeRoot(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(filepath.Join(dir, "root"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// outside file lives outside root
	outside := filepath.Join(dir, "outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	// symlink inside root pointing outside
	if err := os.Symlink(outside, filepath.Join(dir, "root", "escape")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	ctx := context.Background()
	if _, err := s.Read(ctx, "escape/secret.txt"); err == nil {
		t.Fatal("expected error reading through symlink escaping root")
	}
	if err := s.Write(ctx, "escape/write.txt", strings.NewReader("x")); err == nil {
		t.Fatal("expected error writing through symlink escaping root")
	}
}

func TestWriteHonorsContextCancellation(t *testing.T) {
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel before writing
	if err := s.Write(ctx, "k", strings.NewReader("x")); err == nil {
		t.Fatal("expected error when context already cancelled")
	}
	if _, err := s.Read(ctx, "k"); err == nil {
		t.Fatal("expected error when context already cancelled")
	}
}

func TestWriteCancellationDuringCopyPreservesExistingBlob(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Write(context.Background(), "artifact.txt", strings.NewReader("old")); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	err = s.Write(ctx, "artifact.txt", cancelAfterFirstRead{cancel: cancel})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Write error = %v, want context.Canceled", err)
	}

	r, err := s.Read(context.Background(), "artifact.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "old" {
		t.Errorf("destination changed after canceled write: got %q, want old", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".staging-") {
			t.Errorf("staging file %q was not cleaned up", entry.Name())
		}
	}
}

type cancelAfterFirstRead struct {
	cancel func()
	read   bool
}

func (r cancelAfterFirstRead) Read(p []byte) (int, error) {
	if r.read {
		return 0, io.EOF
	}
	copy(p, "new")
	r.cancel()
	return len("new"), nil
}

func TestRenameMovesWithinRoot(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()
	ctx := context.Background()

	if err := s.Write(ctx, "pending/abc", strings.NewReader("bytes")); err != nil {
		t.Fatalf("Write staging: %v", err)
	}
	if err := s.Rename(ctx, "pending/abc", "sha256/feedface"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if s, _ := s.Exists(ctx, "pending/abc"); s {
		t.Error("staging key should be gone after rename")
	}
	if s, _ := s.Exists(ctx, "sha256/feedface"); !s {
		t.Error("final key should exist after rename")
	}
	out, err := s.Read(ctx, "sha256/feedface")
	if err != nil {
		t.Fatalf("Read after rename: %v", err)
	}
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(out)
	out.Close()
	if buf.String() != "bytes" {
		t.Errorf("content after rename = %q, want bytes", buf.String())
	}
}
