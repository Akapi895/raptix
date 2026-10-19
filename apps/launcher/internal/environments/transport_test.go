package environments

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testToken = "0123456789abcdef0123456789abcdef-controller-token"

func newTestHandler(t *testing.T, docker *fakeDocker) http.Handler {
	t.Helper()
	handler, err := NewHandler(newTestController(t, docker, echoPath), testToken)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	return handler
}

func post(t *testing.T, handler http.Handler, op, token string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/environments/"+op, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return out
}

func TestControllerRequiresTheBearerTokenAndPostOnly(t *testing.T) {
	handler := newTestHandler(t, newFakeDocker())
	body := mustJSON(t, requestFor("alpha", RoleSandbox, 1))
	if rec := post(t, handler, "ensure", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token = %d, want 401", rec.Code)
	}
	if rec := post(t, handler, "ensure", "wrong-token-value-that-is-long-enough-1234", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token = %d, want 401", rec.Code)
	}
	get := httptest.NewRequest(http.MethodGet, "/v1/environments/ensure", nil)
	get.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, get)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET = %d, want 405", rec.Code)
	}
}

func TestControllerBoundsBodiesAndRejectsUnknownFields(t *testing.T) {
	handler := newTestHandler(t, newFakeDocker())
	oversized := []byte(`{"image":"` + strings.Repeat("a", maxRequestBytes) + `"}`)
	if rec := post(t, handler, "ensure", testToken, oversized); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body = %d, want 413", rec.Code)
	}
	withExtra := []byte(`{"identity":{"deploymentId":"deploy-1","projectId":"proj-alpha","environmentId":"env-alpha","role":"sandbox","generation":1},"containerName":"docker.sock"}`)
	if rec := post(t, handler, "ensure", testToken, withExtra); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown field = %d, want 400", rec.Code)
	}
}

func TestEnsureReturnsOwnedObservationAndStableErrorCodes(t *testing.T) {
	docker := newFakeDocker()
	handler := newTestHandler(t, docker)
	body := mustJSON(t, requestFor("alpha", RoleRuntime, 1))
	rec := post(t, handler, "ensure", testToken, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("ensure = %d: %s", rec.Code, rec.Body.String())
	}
	var ok response
	if err := json.Unmarshal(rec.Body.Bytes(), &ok); err != nil || ok.Status != "ok" || ok.Observation == nil || !ok.Observation.Exists {
		t.Fatalf("ensure body = %s (%v)", rec.Body.String(), err)
	}

	docker.containers[identityFor("bravo", RoleSandbox, 1).ContainerName()] = &fakeContainer{labels: map[string]string{LabelManaged: "true", LabelDeployment: "other"}}
	foreign := post(t, handler, "ensure", testToken, mustJSON(t, requestFor("bravo", RoleSandbox, 1)))
	if foreign.Code != http.StatusConflict || !strings.Contains(foreign.Body.String(), `"foreign_resource"`) {
		t.Fatalf("foreign = %d %s", foreign.Code, foreign.Body.String())
	}
	if strings.Contains(foreign.Body.String(), "Error:") || strings.Contains(foreign.Body.String(), "docker") {
		t.Fatalf("docker stderr leaked to the caller: %s", foreign.Body.String())
	}

	pathReq := requestFor("charlie", RoleSandbox, 1)
	pathReq.WorkspaceHostPath = `D:\other\proj-charlie`
	if rec := post(t, handler, "ensure", testToken, mustJSON(t, pathReq)); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "rejected_path") {
		t.Fatalf("outside-root path = %d %s", rec.Code, rec.Body.String())
	}
	if rec := post(t, handler, "frobnicate", testToken, body); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown operation = %d, want 404", rec.Code)
	}
}

func TestStopUncertainReturnsTheStillRunningObservation(t *testing.T) {
	docker := newFakeDocker()
	handler := newTestHandler(t, docker)
	if rec := post(t, handler, "ensure", testToken, mustJSON(t, requestFor("alpha", RoleSandbox, 1))); rec.Code != http.StatusOK {
		t.Fatalf("ensure = %d", rec.Code)
	}
	post(t, handler, "start", testToken, mustJSON(t, requestFor("alpha", RoleSandbox, 1)))
	docker.stuck[identityFor("alpha", RoleSandbox, 1).ContainerName()] = true
	rec := post(t, handler, "stop", testToken, mustJSON(t, requestFor("alpha", RoleSandbox, 1)))
	var body response
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if rec.Code != http.StatusConflict || body.Error != "stop_uncertain" || body.Observation == nil || !body.Observation.Running {
		t.Fatalf("stuck stop = %d %s", rec.Code, rec.Body.String())
	}
}

func TestServerListensOnlyOnLoopback(t *testing.T) {
	handler := newTestHandler(t, newFakeDocker())
	for _, addr := range []string{"0.0.0.0:9000", ":9000", "example.com:9000", "10.0.0.5:9000", "localhost:9000"} {
		if _, err := NewServer(addr, handler); err == nil {
			t.Fatalf("NewServer(%q) accepted a non-loopback address", addr)
		}
	}
	for _, addr := range []string{"127.0.0.1:9000", "[::1]:9000"} {
		srv, err := NewServer(addr, handler)
		if err != nil || srv.ReadHeaderTimeout == 0 || srv.MaxHeaderBytes == 0 {
			t.Fatalf("NewServer(%q) = %v, timeouts unset", addr, err)
		}
	}
}

func TestHandlerRefusesShortTokens(t *testing.T) {
	if _, err := NewHandler(newTestController(t, newFakeDocker(), echoPath), "short"); err == nil {
		t.Fatal("a token shorter than 32 bytes must be refused")
	}
}
