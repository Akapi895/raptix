package environments

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	maxRequestBytes = 64 << 10
	// operationTimeout bounds one operation. It is deliberately not tied to the request: a stop that is already running
	// must finish or be reported, even when the caller has given up waiting, so the outcome stays observable.
	operationTimeout = 2 * time.Minute
	minTokenBytes    = 32
)

// NewServer returns an HTTP server bound to a loopback IP address only. The
// controller is never reachable from another host (ADR-0092 transport decision).
func NewServer(addr string, handler http.Handler) (*http.Server, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("controller address: %w", err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("controller must listen on a loopback IP address")
	}
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}, nil
}

// NewHandler serves the six allowlisted operations behind one bearer token.
// The token is held only as a digest, and the comparison is constant-time.
func NewHandler(ctrl *Controller, token string) (http.Handler, error) {
	if len(token) < minTokenBytes {
		return nil, fmt.Errorf("controller token must be at least %d bytes", minTokenBytes)
	}
	h := &handler{ctrl: ctrl, tokenDigest: sha256.Sum256([]byte(token))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/environments/{op}", h.serve)
	return mux, nil
}

type handler struct {
	ctrl        *Controller
	tokenDigest [32]byte
}

type response struct {
	Status      string       `json:"status,omitempty"`
	Observation *Observation `json:"observation,omitempty"`
	Error       string       `json:"error,omitempty"`
}

func (h *handler) serve(w http.ResponseWriter, r *http.Request) {
	if !h.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, response{Error: "unauthorized"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req Request
	if err := dec.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, response{Error: "request_too_large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, response{Error: "invalid_request"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), operationTimeout)
	defer cancel()
	obs, err := h.run(ctx, r.PathValue("op"), req)
	if err != nil {
		status, code := statusFor(err)
		body := response{Error: code}
		if errors.Is(err, ErrStillRunning) {
			body.Observation = &obs
		}
		writeJSON(w, status, body)
		return
	}
	writeJSON(w, http.StatusOK, response{Status: "ok", Observation: &obs})
}

func (h *handler) authorized(r *http.Request) bool {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return false
	}
	digest := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(digest[:], h.tokenDigest[:]) == 1
}

func (h *handler) run(ctx context.Context, op string, req Request) (Observation, error) {
	switch op {
	case "ensure":
		return h.ctrl.Ensure(ctx, req)
	case "recreate":
		return h.ctrl.Recreate(ctx, req)
	case "start":
		return h.ctrl.Start(ctx, req.Identity)
	case "observe":
		return h.ctrl.Observe(ctx, req.Identity)
	case "stop":
		return h.ctrl.Stop(ctx, req.Identity, req.StopTimeoutSecs)
	case "remove":
		return Observation{}, h.ctrl.Remove(ctx, req.Identity)
	}
	return Observation{}, ErrNotFound
}

// statusFor maps errors to stable codes. Docker's stderr is never returned to the caller.
func statusFor(err error) (int, string) {
	switch {
	case errors.Is(err, ErrInvalidIdentity), errors.Is(err, errInvalidSpec):
		return http.StatusUnprocessableEntity, "invalid_request"
	case errors.Is(err, ErrRejectedPath):
		return http.StatusUnprocessableEntity, "rejected_path"
	case errors.Is(err, ErrRejectedImage):
		return http.StatusUnprocessableEntity, "rejected_image"
	case errors.Is(err, ErrForeignResource):
		return http.StatusConflict, "foreign_resource"
	case errors.Is(err, ErrGenerationMismatch):
		return http.StatusConflict, "generation_mismatch"
	case errors.Is(err, ErrRunning):
		return http.StatusConflict, "running"
	case errors.Is(err, ErrStillRunning):
		return http.StatusConflict, "stop_uncertain"
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound, "not_found"
	case errors.Is(err, ErrImageMissing):
		return http.StatusServiceUnavailable, "image_missing"
	case errors.Is(err, ErrUnavailable):
		return http.StatusServiceUnavailable, "unavailable"
	}
	return http.StatusInternalServerError, "internal"
}

func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
