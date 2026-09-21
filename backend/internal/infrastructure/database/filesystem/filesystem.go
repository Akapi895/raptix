// Package filesystem provides a shared blob store for artifacts.
// All access is confined to the store root via os.Root (prevents symlink/path
// escape); writes are atomic via staging + rename within the root.
package filesystem

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Store reads and writes blobs on the filesystem, confined to root via os.Root.
type Store struct {
	root *os.Root
	abs  string
}

// NewStore opens (creating if needed) the root directory.
func NewStore(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("filesystem root must not be empty")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve filesystem root %q: %w", root, err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir filesystem root %q: %w", abs, err)
	}
	r, err := os.OpenRoot(abs)
	if err != nil {
		return nil, fmt.Errorf("open filesystem root %q: %w", abs, err)
	}
	return &Store{root: r, abs: abs}, nil
}

// Root returns the absolute root path.
func (s *Store) Root() string {
	return s.abs
}

// Close closes the root handle.
func (s *Store) Close() error {
	return s.root.Close()
}

func validateKey(key string) error {
	if key == "" {
		return fmt.Errorf("artifact key must not be empty")
	}
	if strings.HasPrefix(key, "/") || strings.HasPrefix(key, "\\") {
		return fmt.Errorf("artifact key %q must be relative", key)
	}
	for _, part := range strings.FieldsFunc(key, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." || part == "." {
			return fmt.Errorf("artifact key %q must not contain %q component", key, part)
		}
	}
	return nil
}

// Write stores reader content at key via staging then an atomic rename.
func (s *Store) Write(ctx context.Context, key string, r io.Reader) error {
	if err := validateKey(key); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.root.MkdirAll(filepath.Dir(filepath.FromSlash(key)), 0o755); err != nil {
		return fmt.Errorf("mkdir artifact dir: %w", err)
	}

	staging, name, err := s.newStaging()
	if err != nil {
		return err
	}
	committed := false
	closed := false
	defer func() {
		if !closed {
			_ = staging.Close()
		}
		if !committed {
			_ = s.root.Remove(name)
		}
	}()

	if _, err := copyWithContext(ctx, staging, r); err != nil {
		return fmt.Errorf("write staging: %w", err)
	}
	if err := staging.Sync(); err != nil {
		return fmt.Errorf("sync staging: %w", err)
	}
	if err := staging.Close(); err != nil {
		return fmt.Errorf("close staging: %w", err)
	}
	closed = true
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.root.Rename(name, filepath.FromSlash(key)); err != nil {
		return fmt.Errorf("promote staging: %w", err)
	}
	committed = true
	return nil
}

// copyWithContext checks ctx before/after each Read and before each Write.
// A reader blocked inside Read cannot be interrupted safely unless it has its
// own cancellation contract; Store does not own the reader so it never closes it.
func copyWithContext(ctx context.Context, dst io.Writer, src io.Reader) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		nr, readErr := src.Read(buf)
		if nr > 0 {
			if err := ctx.Err(); err != nil {
				return total, err
			}
			nw, writeErr := dst.Write(buf[:nr])
			total += int64(nw)
			if writeErr != nil {
				return total, writeErr
			}
			if nw != nr {
				return total, io.ErrShortWrite
			}
			if err := ctx.Err(); err != nil {
				return total, err
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return total, nil
			}
			return total, readErr
		}
	}
}

// newStaging creates a temporary staging file in root with a random name (O_EXCL).
func (s *Store) newStaging() (*os.File, string, error) {
	for i := 0; i < 16; i++ {
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			return nil, "", fmt.Errorf("random staging name: %w", err)
		}
		name := ".staging-" + hex.EncodeToString(b)
		f, err := s.root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			if os.IsExist(err) {
				continue
			}
			return nil, "", fmt.Errorf("create staging: %w", err)
		}
		return f, name, nil
	}
	return nil, "", fmt.Errorf("create staging: unique name exhausted")
}

// Read opens a reader for key; the caller is responsible for closing it.
func (s *Store) Read(ctx context.Context, key string) (io.ReadCloser, error) {
	if err := validateKey(key); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f, err := s.root.Open(filepath.FromSlash(key))
	if err != nil {
		return nil, fmt.Errorf("open artifact %q: %w", key, err)
	}
	return f, nil
}

// Exists reports whether key is present.
func (s *Store) Exists(ctx context.Context, key string) (bool, error) {
	if err := validateKey(key); err != nil {
		return false, err
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	_, err := s.root.Stat(filepath.FromSlash(key))
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, fmt.Errorf("stat artifact %q: %w", key, err)
}

// Delete removes key; missing keys are not an error.
func (s *Store) Delete(ctx context.Context, key string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.root.Remove(filepath.FromSlash(key)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete artifact %q: %w", key, err)
	}
	return nil
}
