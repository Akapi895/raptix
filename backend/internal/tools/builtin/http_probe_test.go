package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

// fakeWriter captures registered bytes and returns a deterministic artifact id.
type fakeWriter struct {
	mu    sync.Mutex
	id    uuid.UUID
	last  []byte
	calls int
	fail  bool
}

func (f *fakeWriter) Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, err := io.ReadAll(r)
	if err != nil {
		return evidence.Artifact{}, err
	}
	f.calls++
	f.last = b
	if f.fail {
		return evidence.Artifact{}, io.ErrUnexpectedEOF
	}
	return evidence.Artifact{ID: f.id, Size: int64(len(b))}, nil
}

const probeCap = 1 << 20

func newProbe(w EvidenceWriter) *HTTPProbe {
	return NewHTTPProbe(w, 5*time.Second, probeCap)
}

func TestHTTPProbeSuccessRecordsResponse(t *testing.T) {
	var mu sync.Mutex
	got := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = r.Method
		mu.Unlock()
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello world"))
	}))
	defer srv.Close()

	fw := &fakeWriter{id: uuid.New()}
	res, err := newProbe(fw).Invoke(context.Background(), mustJSON(map[string]interface{}{"url": srv.URL, "method": "POST"}))
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	method := got
	mu.Unlock()
	if method != "POST" {
		t.Errorf("method = %q, want POST", method)
	}
	if res.Execution != output.ExecutionSuccess {
		t.Errorf("res = %+v, want success execution", res)
	}
	if res.RawRef == "" {
		t.Error("expected raw ref set")
	}
	if !bytes.Contains(fw.last, []byte("hello world")) {
		t.Errorf("recorded evidence lacks body: %q", fw.last)
	}
}

func TestHTTPProbeErrorOnBadURL(t *testing.T) {
	fw := &fakeWriter{id: uuid.New()}
	res, err := newProbe(fw).Invoke(context.Background(), mustJSON(map[string]interface{}{"url": "not a url"}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionFailed {
		t.Errorf("execution = %s, want failed", res.Execution)
	}
	if fw.calls != 0 {
		t.Error("no evidence should be recorded for an invalid request")
	}
}

func TestHTTPProbeConnectionRefused(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()

	fw := &fakeWriter{id: uuid.New()}
	res, err := newProbe(fw).Invoke(context.Background(), mustJSON(map[string]interface{}{"url": "http://" + addr}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionFailed {
		t.Errorf("execution = %s, want failed", res.Execution)
	}
}

func TestHTTPProbeEvidenceFailureFailsResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("x")) }))
	defer srv.Close()
	fw := &fakeWriter{id: uuid.New(), fail: true}
	res, err := newProbe(fw).Invoke(context.Background(), mustJSON(map[string]interface{}{"url": srv.URL}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionFailed {
		t.Errorf("execution = %s, want failed when evidence write fails", res.Execution)
	}
}

func TestHTTPProbeTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()

	probe := NewHTTPProbe(&fakeWriter{id: uuid.New()}, 50*time.Millisecond, probeCap)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	res, err := probe.Invoke(ctx, mustJSON(map[string]interface{}{"url": srv.URL}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionTimedOut {
		t.Errorf("execution = %s, want timed_out", res.Execution)
	}
}

func mustJSON(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
