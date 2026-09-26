package api

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"
)

type healthy struct{}

func (healthy) Health(context.Context) error { return nil }

type fakeAuth struct {
	principal Principal
	err       error
}

func (a fakeAuth) Authenticate(context.Context, string) (Principal, error) { return a.principal, a.err }

type fakeUseCases struct {
	run         Run
	evidence    Evidence
	createActor Principal
	createKey   string
}

func (f *fakeUseCases) ListProjects(context.Context, Principal) ([]Project, error) {
	return []Project{}, nil
}
func (f *fakeUseCases) GetProject(context.Context, Principal, uuid.UUID) (Project, error) {
	return Project{}, nil
}
func (f *fakeUseCases) ListScopes(context.Context, Principal, uuid.UUID) ([]Scope, error) {
	return []Scope{}, nil
}
func (f *fakeUseCases) ListRuns(context.Context, Principal, uuid.UUID) ([]Run, error) {
	return []Run{}, nil
}
func (f *fakeUseCases) CreateRun(_ context.Context, p Principal, project, scope uuid.UUID, name, key string) (Run, error) {
	f.createActor = p
	f.createKey = key
	return f.run, nil
}
func (f *fakeUseCases) GetRun(context.Context, Principal, uuid.UUID) (Run, error) { return f.run, nil }
func (f *fakeUseCases) ListTasks(context.Context, Principal, uuid.UUID) ([]Task, error) {
	return []Task{}, nil
}
func (f *fakeUseCases) ListAgents(context.Context, Principal, uuid.UUID) ([]Agent, error) {
	return []Agent{}, nil
}
func (f *fakeUseCases) CreateAgent(context.Context, Principal, uuid.UUID, *uuid.UUID, string, string) (Agent, error) {
	return Agent{}, nil
}
func (f *fakeUseCases) RunAgentAttempt(context.Context, Principal, uuid.UUID, string, string) (AttemptResult, error) {
	return AttemptResult{}, nil
}
func (f *fakeUseCases) CancelRun(context.Context, Principal, uuid.UUID) (Run, error) {
	return f.run, nil
}
func (f *fakeUseCases) ListEvidence(context.Context, Principal, uuid.UUID) ([]Evidence, error) {
	return []Evidence{f.evidence}, nil
}
func (f *fakeUseCases) GetEvidence(context.Context, Principal, uuid.UUID) (Evidence, error) {
	return f.evidence, nil
}
func (f *fakeUseCases) OpenEvidence(context.Context, Principal, uuid.UUID) (Evidence, io.ReadCloser, error) {
	return f.evidence, io.NopCloser(strings.NewReader("x")), nil
}
func (f *fakeUseCases) ListFindings(context.Context, Principal, uuid.UUID) ([]Finding, error) {
	return []Finding{}, nil
}
func (f *fakeUseCases) GetFinding(context.Context, Principal, uuid.UUID) (Finding, error) {
	return Finding{}, nil
}
func (f *fakeUseCases) ListFindingRevisions(context.Context, Principal, uuid.UUID) ([]FindingRevision, error) {
	return []FindingRevision{}, nil
}
func (f *fakeUseCases) ReviseFinding(context.Context, Principal, uuid.UUID, int, ReviseFindingInput) (Finding, error) {
	return Finding{}, nil
}
func (f *fakeUseCases) ReviewFinding(context.Context, Principal, uuid.UUID, int, string, string) (Finding, error) {
	return Finding{}, nil
}
func (f *fakeUseCases) CreateReport(context.Context, Principal, uuid.UUID, string, string, string) (Report, error) {
	return Report{}, nil
}
func (f *fakeUseCases) GetReport(context.Context, Principal, uuid.UUID) (Report, error) {
	return Report{}, nil
}
func (f *fakeUseCases) OpenReportContent(context.Context, Principal, uuid.UUID) (Report, io.ReadCloser, error) {
	return Report{}, io.NopCloser(strings.NewReader("")), nil
}
func (f *fakeUseCases) Snapshot(context.Context, Principal, uuid.UUID) (RunSnapshot, error) {
	return RunSnapshot{Run: f.run}, nil
}

func TestCreateRunUsesAuthenticatedPrincipalAndValidatesKey(t *testing.T) {
	run := Run{ID: uuid.New(), ProjectID: uuid.New(), ScopeID: uuid.New(), Name: "run"}
	use := &fakeUseCases{run: run}
	handler := Router(healthy{}, slog.Default(), nil, use, fakeAuth{principal: Principal{Subject: "token-subject"}}, NewHub(2))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+run.ProjectID.String()+"/runs", bytes.NewBufferString(`{"scopeId":"`+run.ScopeID.String()+`","name":"demo","actor":"attacker"}`))
	request.Header.Set("Idempotency-Key", "retry-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+run.ProjectID.String()+"/runs", bytes.NewBufferString(`{"scopeId":"`+run.ScopeID.String()+`","name":"demo"}`))
	request.Header.Set("Idempotency-Key", "retry-1")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if use.createActor.Subject != "token-subject" || use.createKey != "retry-1" {
		t.Fatalf("use case received %#v key %q", use.createActor, use.createKey)
	}
}

func TestProblemAndEvidenceViewDoNotLeakStorage(t *testing.T) {
	id := uuid.New()
	use := &fakeUseCases{evidence: Evidence{ID: id, MIME: "text/plain"}}
	handler := Router(healthy{}, slog.Default(), nil, use, fakeAuth{err: Unauthorized("bad token")}, NewHub(2))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/evidence/"+id.String(), nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 401 || response.Header().Get("Content-Type") != "application/problem+json" || !strings.Contains(response.Body.String(), `"requestId"`) {
		t.Fatalf("unexpected problem: %d %s", response.Code, response.Body.String())
	}
	handler = Router(healthy{}, slog.Default(), nil, use, fakeAuth{principal: Principal{Subject: "a"}}, NewHub(2))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if strings.Contains(response.Body.String(), "storageKey") {
		t.Fatalf("evidence leaked storage location: %s", response.Body.String())
	}
}

func TestSSEStartsWithAuthorizedSnapshotAndReplay(t *testing.T) {
	run := Run{ID: uuid.New()}
	use := &fakeUseCases{run: run}
	hub := NewHub(2)
	hub.Publish(run.ID, "updated", map[string]string{"action": "created"})
	handler := Router(healthy{}, slog.Default(), nil, use, fakeAuth{principal: Principal{Subject: "a"}}, hub)
	server := httptest.NewServer(handler)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/runs/"+run.ID.String()+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(response.Body)
	var stream strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		stream.WriteString(line)
		if line == "\n" {
			break
		}
	}
	cancel()
	_ = response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(stream.String(), "event: snapshot") {
		t.Fatalf("stream=%d %s", response.StatusCode, stream.String())
	}
}

func TestOIDCModeRequiresConfiguration(t *testing.T) {
	if _, err := NewAuthenticator(context.Background(), AuthConfig{Mode: "oidc"}); err == nil {
		t.Fatal("missing issuer/audience accepted")
	}
	if _, err := NewAuthenticator(context.Background(), AuthConfig{Mode: "development", DevelopmentPrincipal: ""}); err == nil {
		t.Fatal("empty development principal accepted")
	}
	if _, err := NewAuthenticator(context.Background(), AuthConfig{Mode: "invalid"}); err == nil {
		t.Fatal("invalid mode accepted")
	}
}

func TestOIDCVerifierChecksIssuerAudienceSignatureAndExpiry(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{"issuer": issuer, "jwks_uri": issuer + "/keys"})
		case "/keys":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: string(jose.RS256), Use: "sig"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	issuer = server.URL
	auth, err := NewAuthenticator(context.Background(), AuthConfig{Mode: "oidc", Issuer: issuer, Audience: "raptix-api"})
	if err != nil {
		t.Fatalf("NewAuthenticator: %v", err)
	}
	valid := signedToken(t, key, issuer, "raptix-api", time.Now().Add(time.Minute))
	p, err := auth.Authenticate(context.Background(), "Bearer "+valid)
	if err != nil || p.Subject != "subject-1" {
		t.Fatalf("valid token: principal=%#v err=%v", p, err)
	}
	for _, token := range []string{
		signedToken(t, key, issuer, "other-audience", time.Now().Add(time.Minute)),
		signedToken(t, key, issuer, "raptix-api", time.Now().Add(-time.Minute)),
		valid + "x",
	} {
		if _, err := auth.Authenticate(context.Background(), "Bearer "+token); err == nil {
			t.Fatal("invalid OIDC token was accepted")
		}
	}
}

func signedToken(t *testing.T, key *rsa.PrivateKey, issuer, audience string, expiry time.Time) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := jwt.Signed(signer).Claims(map[string]any{"iss": issuer, "sub": "subject-1", "aud": audience, "exp": expiry.Unix()}).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
