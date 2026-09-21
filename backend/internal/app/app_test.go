package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func newTestApp(t *testing.T, shutdownTimeout time.Duration) *App {
	t.Helper()
	cfg := defaults()
	cfg.Server.Addr = "127.0.0.1:0"
	cfg.Server.ShutdownTimeout = shutdownTimeout
	cfg.Artifact.Root = t.TempDir()
	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)
	return a
}

// TestGracefulShutdownWaitsForInFlight verifies the server waits for an in-flight
// request to finish before reporting a successful shutdown.
func TestGracefulShutdownWaitsForInFlight(t *testing.T) {
	a := newTestApp(t, 3*time.Second)
	started := make(chan struct{})
	handlerDone := make(chan struct{})
	a.srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		time.Sleep(100 * time.Millisecond)
		_, _ = w.Write([]byte("done"))
		close(handlerDone)
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serveErr := make(chan error, 1)
	go func() { serveErr <- a.Serve(ctx, ln) }()

	response := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: time.Second}
		resp, err := client.Get("http://" + ln.Addr().String())
		if err == nil {
			_, err = io.ReadAll(resp.Body)
			resp.Body.Close()
		}
		response <- err
	}()

	waitFor(t, started, "handler start")
	cancel()
	waitFor(t, handlerDone, "handler finish")
	if err := waitErr(t, response, "response"); err != nil {
		t.Fatalf("in-flight request failed: %v", err)
	}
	if err := waitErr(t, serveErr, "server shutdown"); err != nil {
		t.Fatalf("Serve: %v", err)
	}
}

// TestShutdownTimeoutCancelsRequestAndReturnsError verifies the timeout path
// cancels active request contexts and does not report a successful shutdown.
func TestShutdownTimeoutCancelsRequestAndReturnsError(t *testing.T) {
	a := newTestApp(t, 50*time.Millisecond)
	started := make(chan struct{})
	handlerDone := make(chan struct{})
	a.srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(handlerDone)
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serveErr := make(chan error, 1)
	go func() { serveErr <- a.Serve(ctx, ln) }()

	go func() {
		_, _ = http.Get("http://" + ln.Addr().String())
	}()
	waitFor(t, started, "handler start")
	cancel()
	waitFor(t, handlerDone, "handler cancellation")
	if err := waitErr(t, serveErr, "server shutdown"); err == nil {
		t.Fatal("Serve returned nil after shutdown timeout")
	}
}

// TestShutdownTimeoutKeepsStorageOpenForUncooperativeHandler verifies storage
// is not closed while a handler that ignores cancellation is still running.
func TestShutdownTimeoutKeepsStorageOpenForUncooperativeHandler(t *testing.T) {
	a := newTestApp(t, 25*time.Millisecond)
	started := make(chan struct{})
	release := make(chan struct{})
	handlerDone := make(chan struct{})
	a.srv.Handler = a.requests.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release // deliberately ignores r.Context().Done()
		close(handlerDone)
	}))

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serveErr := make(chan error, 1)
	go func() { serveErr <- a.Serve(ctx, ln) }()

	go func() {
		client := &http.Client{Timeout: time.Second}
		_, _ = client.Get("http://" + ln.Addr().String())
	}()
	waitFor(t, started, "handler start")
	cancel()
	if err := waitErr(t, serveErr, "server shutdown"); err == nil {
		t.Fatal("Serve returned nil after uncooperative shutdown timeout")
	}

	// The handler remains active, so storage must not have been closed yet.
	if err := a.fs.Write(context.Background(), "still-open", strings.NewReader("ok")); err != nil {
		t.Fatalf("storage was closed while handler was active: %v", err)
	}
	close(release)
	waitFor(t, handlerDone, "uncooperative handler finish")
}

// TestServeFailureDoesNotLeaveShutdownGoroutine verifies a non-temporary Accept
// error triggers cleanup once; canceling the parent context afterwards cannot panic.
func TestServeFailureDoesNotLeaveShutdownGoroutine(t *testing.T) {
	a := newTestApp(t, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	err := a.Serve(ctx, failingListener{})
	if err == nil {
		t.Fatal("expected Serve error")
	}
	cancel()
	// Give a leaked/double-close goroutine a chance to execute under the race detector.
	time.Sleep(20 * time.Millisecond)
}

func waitFor(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func waitErr(t *testing.T, ch <-chan error, what string) error {
	t.Helper()
	select {
	case err := <-ch:
		return err
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
		return nil
	}
}

type failingListener struct{}

func (failingListener) Accept() (net.Conn, error) { return nil, errors.New("accept failed") }
func (failingListener) Close() error              { return nil }
func (failingListener) Addr() net.Addr            { return &net.TCPAddr{} }
