// Package api provides the HTTP transport for cmd/server.
package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

type Pinger interface{ Health(context.Context) error }

func Router(db Pinger, log *slog.Logger, requests *RequestTracker, use UseCases, auth Authenticator, hub *Hub) http.Handler {
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
	if use == nil || auth == nil {
		return r
	}
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(authenticate(auth))
		r.Get("/projects", func(w http.ResponseWriter, r *http.Request) {
			p, ok := principal(r)
			if !ok {
				problem(w, r, Unauthorized("authentication required"))
				return
			}
			items, err := use.ListProjects(r.Context(), p)
			list(w, r, items, err)
		})
		r.Get("/projects/{projectId}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "projectId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.GetProject(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/projects/{projectId}/scopes", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "projectId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListScopes(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Get("/projects/{projectId}/runs", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "projectId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListRuns(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Post("/projects/{projectId}/runs", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "projectId")
			if !ok {
				return
			}
			key, ok := idempotencyKey(w, r)
			if !ok {
				return
			}
			var body struct {
				ScopeID uuid.UUID `json:"scopeId"`
				Name    string    `json:"name"`
			}
			if !decode(w, r, &body) {
				return
			}
			if body.ScopeID == uuid.Nil || strings.TrimSpace(body.Name) == "" {
				problem(w, r, BadRequest("scopeId and name are required"))
				return
			}
			p, _ := principal(r)
			v, e := use.CreateRun(r.Context(), p, id, body.ScopeID, body.Name, key)
			respond(w, r, 201, v, e)
		})
		r.Get("/runs/{runId}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.GetRun(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/runs/{runId}/tasks", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListTasks(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Get("/runs/{runId}/agents", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListAgents(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Post("/runs/{runId}/agents", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			key, ok := idempotencyKey(w, r)
			if !ok {
				return
			}
			var body struct {
				TaskID  *uuid.UUID `json:"taskId"`
				Profile string     `json:"profile"`
			}
			if !decode(w, r, &body) {
				return
			}
			if strings.TrimSpace(body.Profile) == "" {
				problem(w, r, BadRequest("profile is required"))
				return
			}
			p, _ := principal(r)
			v, e := use.CreateAgent(r.Context(), p, id, body.TaskID, body.Profile, key)
			respond(w, r, 201, v, e)
		})
		r.Post("/agents/{agentId}/attempts", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "agentId")
			if !ok {
				return
			}
			key, ok := idempotencyKey(w, r)
			if !ok {
				return
			}
			var body struct {
				Task string `json:"task"`
			}
			if !decode(w, r, &body) {
				return
			}
			if strings.TrimSpace(body.Task) == "" {
				problem(w, r, BadRequest("task is required"))
				return
			}
			p, _ := principal(r)
			v, e := use.RunAgentAttempt(r.Context(), p, id, body.Task, key)
			respond(w, r, 200, v, e)
		})
		r.Post("/runs/{runId}/cancel", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.CancelRun(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/runs/{runId}/evidence", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListEvidence(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Get("/evidence/{evidenceId}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "evidenceId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.GetEvidence(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/evidence/{evidenceId}/content", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "evidenceId")
			if !ok {
				return
			}
			p, _ := principal(r)
			meta, rc, e := use.OpenEvidence(r.Context(), p, id)
			if e != nil {
				problem(w, r, e)
				return
			}
			defer rc.Close()
			w.Header().Set("Content-Type", meta.MIME)
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", meta.ID.String()))
			w.Header().Set("Cache-Control", "no-store")
			_, _ = io.Copy(w, rc)
		})
		r.Get("/runs/{runId}/findings", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListFindings(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Get("/findings/{findingId}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "findingId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.GetFinding(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/findings/{findingId}/revisions", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "findingId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.ListFindingRevisions(r.Context(), p, id)
			list(w, r, v, e)
		})
		r.Post("/findings/{findingId}/revisions", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "findingId")
			if !ok {
				return
			}
			if _, ok := idempotencyKey(w, r); !ok {
				return
			}
			var body struct {
				ExpectedVersion int           `json:"expectedVersion"`
				Title           string        `json:"title"`
				Description     string        `json:"description"`
				Severity        string        `json:"severity"`
				Confidence      string        `json:"confidence"`
				Evidence        []EvidenceRef `json:"evidence"`
				Reason          string        `json:"reason"`
			}
			if !decode(w, r, &body) {
				return
			}
			p, _ := principal(r)
			v, e := use.ReviseFinding(r.Context(), p, id, body.ExpectedVersion, ReviseFindingInput{
				Title: body.Title, Description: body.Description, Severity: body.Severity,
				Confidence: body.Confidence, Evidence: body.Evidence, Reason: body.Reason,
			})
			respond(w, r, 200, v, e)
		})
		r.Post("/findings/{findingId}/reviews", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "findingId")
			if !ok {
				return
			}
			if _, ok := idempotencyKey(w, r); !ok {
				return
			}
			var body struct {
				ExpectedVersion int    `json:"expectedVersion"`
				Decision        string `json:"decision"`
				Reason          string `json:"reason"`
			}
			if !decode(w, r, &body) {
				return
			}
			p, _ := principal(r)
			v, e := use.ReviewFinding(r.Context(), p, id, body.ExpectedVersion, body.Decision, body.Reason)
			respond(w, r, 200, v, e)
		})
		r.Post("/runs/{runId}/reports", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "runId")
			if !ok {
				return
			}
			key, ok := idempotencyKey(w, r)
			if !ok {
				return
			}
			var body struct {
				TemplateID      string `json:"templateId"`
				TemplateVersion string `json:"templateVersion"`
			}
			if !decode(w, r, &body) {
				return
			}
			if strings.TrimSpace(body.TemplateID) == "" || strings.TrimSpace(body.TemplateVersion) == "" {
				problem(w, r, BadRequest("templateId and templateVersion are required"))
				return
			}
			p, _ := principal(r)
			v, e := use.CreateReport(r.Context(), p, id, body.TemplateID, body.TemplateVersion, key)
			respond(w, r, 201, v, e)
		})
		r.Get("/reports/{reportId}", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "reportId")
			if !ok {
				return
			}
			p, _ := principal(r)
			v, e := use.GetReport(r.Context(), p, id)
			respond(w, r, 200, v, e)
		})
		r.Get("/reports/{reportId}/content", func(w http.ResponseWriter, r *http.Request) {
			id, ok := pathID(w, r, "reportId")
			if !ok {
				return
			}
			p, _ := principal(r)
			report, rc, e := use.OpenReportContent(r.Context(), p, id)
			if e != nil {
				problem(w, r, e)
				return
			}
			defer rc.Close()
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", report.ID.String()+".md"))
			w.Header().Set("Cache-Control", "no-store")
			_, _ = io.Copy(w, rc)
		})
		r.Get("/runs/{runId}/events", streamEvents(use, hub))
	})
	return r
}

type principalContextKey struct{}

func authenticate(auth Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, e := auth.Authenticate(r.Context(), r.Header.Get("Authorization"))
			if e != nil {
				problem(w, r, e)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalContextKey{}, p)))
		})
	}
}
func principal(r *http.Request) (Principal, bool) {
	p, ok := r.Context().Value(principalContextKey{}).(Principal)
	return p, ok
}
func pathID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, e := uuid.Parse(chi.URLParam(r, name))
	if e != nil {
		problem(w, r, BadRequest(name+" must be a UUID"))
		return uuid.Nil, false
	}
	return id, true
}
func idempotencyKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	v := r.Header.Get("Idempotency-Key")
	if len(v) == 0 || len(v) > 128 {
		problem(w, r, BadRequest("Idempotency-Key is required and must be at most 128 printable ASCII characters"))
		return "", false
	}
	for _, c := range v {
		if c < 0x20 || c > 0x7e {
			problem(w, r, BadRequest("Idempotency-Key must contain printable ASCII only"))
			return "", false
		}
	}
	return v, true
}
func decode(w http.ResponseWriter, r *http.Request, d any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if e := dec.Decode(d); e != nil {
		problem(w, r, BadRequest("request JSON is invalid"))
		return false
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		problem(w, r, BadRequest("request body must contain one JSON value"))
		return false
	}
	return true
}
func respond(w http.ResponseWriter, r *http.Request, status int, v any, e error) {
	if e != nil {
		problem(w, r, e)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func list[T any](w http.ResponseWriter, r *http.Request, items []T, e error) {
	if e != nil {
		problem(w, r, e)
		return
	}
	limit, offset, err := page(r)
	if err != nil {
		problem(w, r, err)
		return
	}
	if offset > len(items) {
		offset = len(items)
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	var next any
	if end < len(items) {
		next = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end)))
	}
	respond(w, r, 200, map[string]any{"items": items[offset:end], "nextCursor": next}, nil)
}
func page(r *http.Request) (int, int, error) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			return 0, 0, BadRequest("limit must be between 1 and 100")
		}
		limit = n
	}
	offset := 0
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		b, e := base64.RawURLEncoding.DecodeString(raw)
		n, e2 := strconv.Atoi(string(b))
		if e != nil || e2 != nil || n < 0 {
			return 0, 0, BadRequest("cursor is invalid")
		}
		offset = n
	}
	return limit, offset, nil
}
func problem(w http.ResponseWriter, r *http.Request, err error) {
	status := 500
	code := "internal_error"
	detail := "an internal error occurred"
	var ae *Error
	if errors.As(err, &ae) {
		status = ae.Status
		code = ae.Code
		detail = ae.Detail
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = 503
		code = "dependency_unavailable"
		detail = "a required dependency is unavailable"
	}
	title := http.StatusText(status)
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "https://raptix.dev/problems/" + code, "title": title, "status": status, "code": code, "detail": detail, "requestId": middleware.GetReqID(r.Context())})
}

func streamEvents(use UseCases, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hub == nil {
			problem(w, r, &Error{Status: 503, Code: "dependency_unavailable", Detail: "event hub is unavailable"})
			return
		}
		id, ok := pathID(w, r, "runId")
		if !ok {
			return
		}
		p, _ := principal(r)
		if _, e := use.GetRun(r.Context(), p, id); e != nil {
			problem(w, r, e)
			return
		}
		cursor := r.Header.Get("Last-Event-ID")
		if cursor == "" {
			cursor = r.URL.Query().Get("cursor")
		}
		replay, gap, ch, unsubscribe, e := hub.Subscribe(id, cursor)
		if e != nil {
			problem(w, r, e)
			return
		}
		defer unsubscribe()
		flusher, ok := w.(http.Flusher)
		if !ok {
			problem(w, r, &Error{Status: 503, Code: "streaming_unavailable", Detail: "streaming is unavailable"})
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		if gap {
			snapshot, e := use.Snapshot(r.Context(), p, id)
			if e != nil {
				problem(w, r, e)
				return
			}
			writeEvent(w, flusher, Event{Type: "snapshot", Data: snapshot})
		}
		for _, event := range replay {
			writeEvent(w, flusher, event)
		}
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case event, open := <-ch:
				if !open {
					return
				}
				writeEvent(w, flusher, event)
			case <-ticker.C:
				writeEvent(w, flusher, Event{Type: "heartbeat", Data: map[string]any{}})
			}
		}
	}
}
func writeEvent(w http.ResponseWriter, f http.Flusher, e Event) {
	if e.ID != "" {
		_, _ = fmt.Fprintf(w, "id: %s\n", e.ID)
	}
	_, _ = fmt.Fprintf(w, "event: %s\n", e.Type)
	b, _ := json.Marshal(e.Data)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
	f.Flush()
}

type RequestTracker struct {
	mu       sync.Mutex
	active   int
	draining bool
	drained  chan struct{}
}

func NewRequestTracker() *RequestTracker { return &RequestTracker{drained: make(chan struct{})} }
func (t *RequestTracker) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.mu.Lock()
		if t.draining {
			t.mu.Unlock()
			problem(w, r, &Error{Status: 503, Code: "draining", Detail: "server is shutting down"})
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
			log.Info("http request", "request_id", middleware.GetReqID(r.Context()), "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "bytes", ww.BytesWritten(), "duration", time.Since(start))
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
