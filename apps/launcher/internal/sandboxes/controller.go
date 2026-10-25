package sandboxes

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

const maxEnsureBytes = 4 << 10

// NewHandler serves the one operation the web API needs from the host: make sure a project's sandbox is running.
// The bearer token is held only as a digest and compared in constant time. Failures return stable codes; Docker's own
// error text stays in the operator's log, never in the response.
func NewHandler(ensure func(slug string) error, token string) (http.Handler, error) {
	if len(token) < minSecretLen {
		return nil, fmt.Errorf("controller token must be at least %d bytes", minSecretLen)
	}
	h := &controllerHandler{ensure: ensure, tokenDigest: sha256.Sum256([]byte(token))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/sandboxes/ensure", h.serve)
	return mux, nil
}

type controllerHandler struct {
	ensure      func(slug string) error
	tokenDigest [sha256.Size]byte
}

type ensureRequest struct {
	Slug string `json:"slug"`
}

type controllerResponse struct {
	Status string `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (h *controllerHandler) serve(w http.ResponseWriter, r *http.Request) {
	if !h.authorized(r) {
		writeControllerJSON(w, http.StatusUnauthorized, controllerResponse{Error: "unauthorized"})
		return
	}
	var req ensureRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxEnsureBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeControllerJSON(w, http.StatusBadRequest, controllerResponse{Error: "bad_request"})
		return
	}
	if err := ValidSlug(req.Slug); err != nil {
		writeControllerJSON(w, http.StatusBadRequest, controllerResponse{Error: "invalid_slug"})
		return
	}
	if err := h.ensure(req.Slug); err != nil {
		writeControllerJSON(w, http.StatusServiceUnavailable, controllerResponse{Error: "provision_failed"})
		return
	}
	writeControllerJSON(w, http.StatusOK, controllerResponse{Status: "ready"})
}

func (h *controllerHandler) authorized(r *http.Request) bool {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	digest := sha256.Sum256([]byte(auth[len(prefix):]))
	return subtle.ConstantTimeCompare(digest[:], h.tokenDigest[:]) == 1
}

func writeControllerJSON(w http.ResponseWriter, status int, body controllerResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		fmt.Fprintf(os.Stderr, "sandbox controller: write response: %v\n", err)
	}
}
