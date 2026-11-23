package opscontrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// Server exposes the workload API through a Unix socket mounted only in the runtime container.
type Server struct {
	Backend   Backend
	Allowlist *Allowlist
	Registry  *registry
	Logger    *slog.Logger
}

// NewServer assembles a server with the standard registry + an
// internal lock map for per-workload serialization.
func NewServer(backend Backend, allow *Allowlist, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, nil))
	}
	return &Server{
		Backend:   backend,
		Allowlist: allow,
		Registry:  newRegistry(),
		Logger:    logger,
	}
}

// Listen binds the Unix socket. The caller cleans up the socket after shutdown.
func (s *Server) Listen(ctx context.Context, socketPath string) error {
	// Remove a stale socket before binding. Refuse to delete other file types.
	if info, err := os.Stat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return fmt.Errorf("opscontrol: %s exists and is not a socket; refusing to overwrite", socketPath)
		}
		if err := os.Remove(socketPath); err != nil {
			return fmt.Errorf("opscontrol: remove stale socket: %w", err)
		}
	}

	lis, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("opscontrol: listen unix %s: %w", socketPath, err)
	}
	// Tighten permissions so only the user that owns $RAPTIX_HOME
	// (and root, and processes that share the bind-mount) can connect.
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = lis.Close()
		return fmt.Errorf("opscontrol: chmod socket: %w", err)
	}

	srv := &http.Server{
		Handler:           s.mux(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		errc <- srv.Serve(lis)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		_ = os.Remove(socketPath)
		return ctx.Err()
	case err := <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) mux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", s.handleHealth)
	mux.HandleFunc("GET /v1/profiles", s.handleList)
	mux.HandleFunc("POST /v1/profiles/{workload}/start", s.handleStart)
	mux.HandleFunc("POST /v1/profiles/{workload}/stop", s.handleStop)
	mux.HandleFunc("POST /v1/engagements/{engagement}/cleanup", s.handleCleanupEngagement)
	return mux
}

// healthResponse reports daemon health and the effective allowlist.
type healthResponse struct {
	OK        bool     `json:"ok"`
	Backend   string   `json:"backend"`
	Allowlist []string `json:"allowlist"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{
		OK:        true,
		Backend:   s.Backend.Name(),
		Allowlist: s.Allowlist.Members(),
	})
}

func (s *Server) handleList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Registry.snapshot())
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	workload := r.PathValue("workload")
	if !s.Allowlist.Permits(workload) {
		writeError(w, http.StatusBadRequest, "workload not in allowlist or contains illegal characters")
		return
	}
	engagementID := strings.TrimSpace(r.URL.Query().Get("engagement"))

	// Return the initial state immediately. Lifecycle work can outlast the HTTP request.

	lock := s.Registry.lockFor(workload)
	lock.Lock()

	// Check state under the workload lock to avoid starting it twice.
	if existing, ok := s.Registry.get(workload); ok {
		switch existing.State {
		case StateRunning, StateStarting:
			lock.Unlock()
			writeJSON(w, http.StatusAccepted, Handle{
				Workload:     workload,
				State:        existing.State,
				EngagementID: existing.EngagementID,
			})
			return
		}
	}

	s.Registry.set(workload, StateStarting, engagementID)

	// The goroutine holds the workload lock. Use the daemon context so an HTTP disconnect cannot cancel startup.
	go func() {
		defer lock.Unlock()
		ctx := context.Background()
		handle, err := s.Backend.Start(ctx, workload, engagementID)
		if err != nil {
			s.Registry.set(workload, StateUnknown, engagementID)
			s.Logger.Error("opscontrol start failed",
				"workload", workload,
				"engagement", engagementID,
				"err", err,
			)
			return
		}
		s.Registry.set(workload, handle.State, engagementID)
		s.Logger.Info("opscontrol start ok",
			"workload", workload,
			"engagement", engagementID,
			"state", string(handle.State),
		)
	}()

	writeJSON(w, http.StatusAccepted, Handle{
		Workload:     workload,
		State:        StateStarting,
		EngagementID: engagementID,
	})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	workload := r.PathValue("workload")
	if !s.Allowlist.Permits(workload) {
		writeError(w, http.StatusBadRequest, "workload not in allowlist or contains illegal characters")
		return
	}

	// Use the daemon context for shutdown so the registry can record the outcome after the HTTP request ends.

	lock := s.Registry.lockFor(workload)
	lock.Lock()

	// Keep the engagement ID so notifications and cleanup records can still identify the workload.
	priorEngagement := ""
	if existing, ok := s.Registry.get(workload); ok {
		priorEngagement = existing.EngagementID
		switch existing.State {
		case StateStopped, StateStopping:
			lock.Unlock()
			writeJSON(w, http.StatusAccepted, Handle{
				Workload:     workload,
				State:        existing.State,
				EngagementID: existing.EngagementID,
			})
			return
		}
	}

	s.Registry.set(workload, StateStopping, priorEngagement)

	go func() {
		defer lock.Unlock()
		ctx := context.Background()
		if err := s.Backend.Stop(ctx, workload); err != nil {
			// Report Unknown when shutdown leaves the container state uncertain.
			s.Registry.set(workload, StateUnknown, priorEngagement)
			s.Logger.Error("opscontrol stop failed",
				"workload", workload,
				"engagement", priorEngagement,
				"err", err,
			)
			return
		}
		s.Registry.set(workload, StateStopped, priorEngagement)
		s.Logger.Info("opscontrol stop ok",
			"workload", workload,
			"engagement", priorEngagement,
		)
	}()

	writeJSON(w, http.StatusAccepted, Handle{
		Workload:     workload,
		State:        StateStopping,
		EngagementID: priorEngagement,
	})
}

// cleanupResponse reports the outcomes of a bulk engagement teardown.
type cleanupResponse struct {
	Engagement string   `json:"engagement"`
	Stopped    []string `json:"stopped"`
	Errors     map[string]string `json:"errors,omitempty"`
}

// engagementName accepts dots and underscores. IDs are used only as registry keys.
var engagementName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

func (s *Server) handleCleanupEngagement(w http.ResponseWriter, r *http.Request) {
	engagement := r.PathValue("engagement")
	if !engagementName.MatchString(engagement) {
		writeError(w, http.StatusBadRequest, "engagement id contains illegal characters")
		return
	}
	targets := s.Registry.workloadsForEngagement(engagement)
	resp := cleanupResponse{Engagement: engagement, Stopped: []string{}, Errors: map[string]string{}}
	for _, workload := range targets {
		lock := s.Registry.lockFor(workload)
		lock.Lock()
		err := s.Backend.Stop(r.Context(), workload)
		if err != nil {
			s.Logger.Error("opscontrol cleanup stop failed",
				"engagement", engagement, "workload", workload, "err", err)
			resp.Errors[workload] = err.Error()
			lock.Unlock()
			continue
		}
		s.Registry.set(workload, StateStopped, "")
		resp.Stopped = append(resp.Stopped, workload)
		lock.Unlock()
	}
	if len(resp.Errors) == 0 {
		resp.Errors = nil
	}
	writeJSON(w, http.StatusAccepted, resp)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type errorEnvelope struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorEnvelope{Error: msg})
}
