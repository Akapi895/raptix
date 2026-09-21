// Package api provides the HTTP transport for cmd/server.
package api

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Pinger reports storage health without coupling transport to infrastructure.
type Pinger interface {
	Health(ctx context.Context) error
}

// Router builds the HTTP handler. Phase 1 only exposes the health endpoint.
func Router(db Pinger, log *slog.Logger, requests *RequestTracker) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	if requests == nil {
		requests = NewRequestTracker()
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(requests.Middleware)
	r.Use(requestLogger(log))

	r.Get("/healthz", handleHealth(db))
	return r
}

// RequestTracker tracks active transport requests during server drain. Once drain
// starts, new requests receive 503 so the returned channel closes only after all
// requests that began before the drain have completed.
type RequestTracker struct {
	mu       sync.Mutex
	active   int
	draining bool
	drained  chan struct{}
}

func NewRequestTracker() *RequestTracker {
	return &RequestTracker{drained: make(chan struct{})}
}

func (t *RequestTracker) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.mu.Lock()
		if t.draining {
			t.mu.Unlock()
			http.Error(w, "shutting down", http.StatusServiceUnavailable)
			return
		}
		t.active++
		t.mu.Unlock()

		defer func() {
			t.mu.Lock()
			t.active--
			if t.draining && t.active == 0 {
				close(t.drained)
			}
			t.mu.Unlock()
		}()
		next.ServeHTTP(w, r)
	})
}

// BeginDrain prevents additional tracked requests and returns a channel that
// closes when all requests already in progress have completed.
func (t *RequestTracker) BeginDrain() <-chan struct{} {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.draining {
		t.draining = true
		if t.active == 0 {
			close(t.drained)
		}
	}
	return t.drained
}

func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)
			log.Info("http request",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration", time.Since(start),
			)
		})
	}
}

func handleHealth(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := db.Health(ctx); err != nil {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}
}
