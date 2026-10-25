package sandboxes

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const controllerToken = "controller-token-0123456789abcdef"

func postEnsure(t *testing.T, h http.Handler, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/sandboxes/ensure", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestControllerRefusesEveryCallerWithoutTheToken(t *testing.T) {
	called := false
	h, err := NewHandler(func(string) error { called = true; return nil }, controllerToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, auth := range []string{"", "Bearer wrong", "Basic " + controllerToken, "Bearer " + controllerToken + "x"} {
		rec := postEnsure(t, h, auth, `{"slug":"lab-a"}`)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("auth %q: status %d, want 401", auth, rec.Code)
		}
	}
	if called {
		t.Fatal("an unauthenticated caller started a sandbox")
	}
}

func TestControllerStartsTheRequestedProjectOnly(t *testing.T) {
	var got string
	h, err := NewHandler(func(slug string) error { got = slug; return nil }, controllerToken)
	if err != nil {
		t.Fatal(err)
	}
	rec := postEnsure(t, h, "Bearer "+controllerToken, `{"slug":"lab-a"}`)
	if rec.Code != http.StatusOK || got != "lab-a" {
		t.Fatalf("status %d, slug %q; want 200 and lab-a", rec.Code, got)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["status"] != "ready" {
		t.Fatalf("body = %s, want status ready", rec.Body.String())
	}
}

func TestControllerRejectsBadSlugsAndExtraFieldsBeforeStarting(t *testing.T) {
	called := false
	h, err := NewHandler(func(string) error { called = true; return nil }, controllerToken)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"slug":"../etc"}`, `{"slug":"Upper"}`, `{"slug":""}`, `{"slug":"lab-a","extra":1}`, `not json`} {
		rec := postEnsure(t, h, "Bearer "+controllerToken, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status %d, want 400", body, rec.Code)
		}
	}
	if called {
		t.Fatal("a rejected request started a sandbox")
	}
}

func TestControllerHidesDockerErrorsFromTheCaller(t *testing.T) {
	h, err := NewHandler(func(string) error { return errors.New("docker: secret detail") }, controllerToken)
	if err != nil {
		t.Fatal(err)
	}
	rec := postEnsure(t, h, "Bearer "+controllerToken, `{"slug":"lab-a"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret detail") || !strings.Contains(rec.Body.String(), "provision_failed") {
		t.Fatalf("body = %s, want the stable code only", rec.Body.String())
	}
}

func TestControllerRefusesAShortToken(t *testing.T) {
	if _, err := NewHandler(func(string) error { return nil }, "short"); err == nil {
		t.Fatal("NewHandler accepted a token shorter than 32 bytes")
	}
}
