package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	projectID  = "11111111-1111-4111-8111-111111111111"
	scopeID    = "22222222-2222-4222-8222-222222222222"
	runID      = "33333333-3333-4333-8333-333333333333"
	agentID    = "44444444-4444-4444-8444-444444444444"
	evidenceID = "55555555-5555-4555-8555-555555555555"
	findingID  = "66666666-6666-4666-8666-666666666666"
)

func TestRunStartUsesServerStateAndKeepsProgressOffJSONStdout(t *testing.T) {
	eventsRequested := make(chan struct{})
	var once sync.Once
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer flag-token" {
			t.Errorf("Authorization = %q", got)
		}
		switch r.URL.Path {
		case "/api/v1/projects/" + projectID + "/runs":
			keys = append(keys, r.Header.Get("Idempotency-Key"))
			assertJSONBody(t, r, map[string]string{"scopeId": scopeID, "name": "assessment"})
			writeJSONResponse(w, map[string]string{"id": runID})
		case "/api/v1/runs/" + runID + "/agents":
			keys = append(keys, r.Header.Get("Idempotency-Key"))
			assertJSONBody(t, r, map[string]string{"profile": "recon"})
			writeJSONResponse(w, map[string]string{"id": agentID})
		case "/api/v1/runs/" + runID + "/events":
			if got := r.Header.Get("Accept"); got != "text/event-stream" {
				t.Errorf("SSE Accept = %q", got)
			}
			once.Do(func() { close(eventsRequested) })
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "id: server:1\nevent: snapshot\ndata: {\"run\":{}}\n\n")
		case "/api/v1/agents/" + agentID + "/attempts":
			<-eventsRequested
			keys = append(keys, r.Header.Get("Idempotency-Key"))
			assertJSONBody(t, r, map[string]string{"task": "probe the lab"})
			writeJSONResponse(w, map[string]any{"attempt": map[string]string{"id": "77777777-7777-4777-8777-777777777777", "status": "succeeded"}, "summary": "complete", "findingId": nil, "verdictId": nil})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	stdout, stderr, err := execute(t, context.Background(), "--server", server.URL, "--token", "flag-token", "--json", "run", "start", "--project", projectID, "--scope", scopeID, "--name", "assessment", "--profile", "recon", "--task", "probe the lab")
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if strings.Contains(stdout, "snapshot") || !strings.Contains(stdout, `"attempt"`) {
		t.Fatalf("stdout must contain result only, got %s", stdout)
	}
	if !strings.Contains(stderr, "snapshot") {
		t.Fatalf("stderr does not contain SSE progress: %s", stderr)
	}
	if len(keys) != 3 {
		t.Fatalf("idempotency key calls = %d, want 3", len(keys))
	}
	seen := map[string]bool{}
	for _, key := range keys {
		if !strings.HasPrefix(key, "cli-") || seen[key] {
			t.Fatalf("idempotency keys = %#v", keys)
		}
		seen[key] = true
	}
}

func TestWatchReconnectsWithLastEventID(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		if requests == 1 {
			if got := r.Header.Get("Last-Event-ID"); got != "" {
				t.Errorf("first cursor = %q", got)
			}
			_, _ = io.WriteString(w, "id: old:1\nevent: run.updated\ndata: {}\n\n")
			return
		}
		if got := r.Header.Get("Last-Event-ID"); got != "old:1" {
			t.Errorf("reconnect cursor = %q", got)
		}
		_, _ = io.WriteString(w, "id: new:1\nevent: snapshot\ndata: {}\n\n")
	}))
	defer server.Close()

	client, err := newClient(server.URL, "token", time.Second, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var types []string
	err = client.Watch(ctx, runID, "", func(event Event) error {
		types = append(types, event.Type)
		if len(types) == 2 {
			cancel()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Watch: %v", err)
	}
	if got, want := strings.Join(types, ","), "run.updated,snapshot"; got != want {
		t.Fatalf("event types = %q, want %q", got, want)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
}

func TestIdempotentRequestRetriesWithTheSameKey(t *testing.T) {
	var receivedKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedKey = r.Header.Get("Idempotency-Key")
		writeJSONResponse(w, map[string]string{"id": runID})
	}))
	defer server.Close()

	calls := 0
	httpClient := server.Client()
	httpClient.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("connection lost before response")
		}
		return http.DefaultTransport.RoundTrip(request)
	})
	client, err := newClient(server.URL, "token", time.Second, httpClient)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.json(context.Background(), http.MethodPost, "/api/v1/projects/"+projectID+"/runs", map[string]string{"scopeId": scopeID, "name": "assessment"}, "retry-key"); err != nil {
		t.Fatalf("json: %v", err)
	}
	if calls != 2 || receivedKey != "retry-key" {
		t.Fatalf("calls=%d received key=%q", calls, receivedKey)
	}
}

func TestServerAndTokenFlagsOverrideEnvironmentAndMapProblems(t *testing.T) {
	t.Setenv("RAP_API_URL", "http://127.0.0.1:1")
	t.Setenv("RAP_API_TOKEN", "environment-token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer flag-token" {
			t.Errorf("Authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"code":"forbidden","detail":"grant required"}`)
	}))
	defer server.Close()

	_, _, err := execute(t, context.Background(), "--api-url", server.URL, "--token", "flag-token", "run", "status", runID)
	if err == nil {
		t.Fatal("status succeeded")
	}
	if got := ExitCode(err); got != 3 {
		t.Fatalf("ExitCode = %d, want 3 (%v)", got, err)
	}
}

func TestReadCommandsUseHTTPResources(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v1/runs/" + runID:
			writeJSONResponse(w, map[string]string{"id": runID, "status": "running", "name": "assessment"})
		case "/api/v1/runs/" + runID + "/cancel":
			writeJSONResponse(w, map[string]string{"id": runID, "status": "cancelled", "name": "assessment"})
		case "/api/v1/runs/" + runID + "/evidence":
			writeJSONResponse(w, map[string]any{"items": []map[string]string{{"id": evidenceID, "status": "ready"}}, "nextCursor": nil})
		case "/api/v1/evidence/" + evidenceID:
			writeJSONResponse(w, map[string]string{"id": evidenceID, "kind": "raw"})
		case "/api/v1/runs/" + runID + "/findings":
			writeJSONResponse(w, map[string]any{"items": []map[string]string{{"id": findingID, "status": "draft", "title": "issue"}}, "nextCursor": nil})
		case "/api/v1/findings/" + findingID:
			writeJSONResponse(w, map[string]string{"id": findingID, "status": "draft", "title": "issue"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	base := []string{"--server", server.URL, "--token", "token"}
	for _, args := range [][]string{{"run", "status", runID}, {"run", "cancel", runID}, {"evidence", "list", runID, "--limit", "10", "--cursor", "a+b"}, {"evidence", "get", evidenceID}, {"finding", "list", runID}, {"finding", "get", findingID}} {
		_, _, err := execute(t, context.Background(), append(base, args...)...)
		if err != nil {
			t.Fatalf("%v: %v", args, err)
		}
	}
	want := []string{
		"/api/v1/runs/" + runID,
		"/api/v1/runs/" + runID + "/cancel",
		"/api/v1/runs/" + runID + "/evidence?limit=10&cursor=a%2Bb",
		"/api/v1/evidence/" + evidenceID,
		"/api/v1/runs/" + runID + "/findings",
		"/api/v1/findings/" + findingID,
	}
	if got := strings.Join(paths, "|"); got != strings.Join(want, "|") {
		t.Fatalf("paths = %q, want %q", got, strings.Join(want, "|"))
	}
}

func TestCompletionDoesNotRequireServerConfiguration(t *testing.T) {
	stdout, _, err := execute(t, context.Background(), "completion", "bash")
	if err != nil {
		t.Fatalf("completion: %v", err)
	}
	if !strings.Contains(stdout, "raptix") {
		t.Fatalf("completion output missing command name")
	}
}

func execute(t *testing.T, ctx context.Context, args ...string) (string, string, error) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	command := NewRootCmd(&stdout, &stderr)
	command.SetArgs(args)
	command.SetContext(ctx)
	err := command.Execute()
	return stdout.String(), stderr.String(), err
}

func assertJSONBody(t *testing.T, request *http.Request, want map[string]string) {
	t.Helper()
	defer request.Body.Close()
	var got map[string]string
	if err := json.NewDecoder(request.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("body = %#v, want %#v", got, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("body[%q] = %q, want %q", key, got[key], value)
		}
	}
}

func writeJSONResponse(writer http.ResponseWriter, value any) {
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(value)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }
