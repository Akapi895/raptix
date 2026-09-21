package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

// TestPhase2Milestone verifies the Phase 2 composition root loads a complete
// profile catalog, registers its declared tool, and wires the OpenAI-compatible
// adapter without requiring a PostgreSQL server (the pool is lazy).
func TestPhase2Milestone(t *testing.T) {
	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writePhase2Catalog(t, contentRoot, "agents/prompts/recon-system.md")

	requests := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %q, want /chat/completions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("Authorization = %q, want Bearer test-key", got)
		}

		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		if request.Model != "profile-model" {
			t.Errorf("model = %q, want profile-model", request.Model)
		}
		if len(request.Messages) != 1 || request.Messages[0].Role != "user" || request.Messages[0].Content != "recon recon" {
			t.Errorf("messages = %+v, want user recon recon", request.Messages)
		}

		requests++
		if requests == 1 {
			if request.Stream {
				t.Error("Chat request stream = true, want false")
			}
			fmt.Fprint(w, `{"id":"chat-1","object":"chat.completion","created":1,"model":"profile-model","choices":[{"index":0,"message":{"role":"assistant","content":"chat-ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)
			return
		}
		if !request.Stream {
			t.Error("Stream request stream = false, want true")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"stream-1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"profile-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"stream-ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer provider.Close()

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = "postgres://raptix:raptix@127.0.0.1:1/raptix?sslmode=disable"
	cfg.LLM.BaseURL = provider.URL
	cfg.LLM.APIKey = "test-key"
	cfg.LLM.Model = "default-model"
	cfg.LLM.Timeout = time.Second
	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)

	if a.content == nil {
		t.Fatal("content loader was not wired")
	}
	profile, err := a.content.LoadProfile("recon")
	if err != nil {
		t.Fatalf("LoadProfile(recon): %v", err)
	}
	if profile.Model != "profile-model" {
		t.Errorf("profile model = %q, want profile-model", profile.Model)
	}
	skill, err := a.content.LoadSkill("offensive-osint")
	if err != nil {
		t.Fatalf("LoadSkill(offensive-osint): %v", err)
	}
	if !strings.Contains(skill.Body, "OSINT guidance body") {
		t.Errorf("skill body = %q", skill.Body)
	}
	if !a.allTools.Compat("nmap", content.ExecutorCommand) {
		t.Error("nmap should be compatible with command executor")
	}
	if a.allTools.Available("nmap") {
		t.Error("declared-only nmap must not be available")
	}
	if a.model == nil {
		t.Fatal("model was not wired")
	}

	req := &llm.ChatRequest{
		Model:    profile.Model,
		Messages: []llm.ChatMessage{{Role: llm.RoleUser, Content: "recon " + profile.Name}},
	}
	response, err := a.model.Chat(context.Background(), req)
	if err != nil {
		t.Fatalf("a.model.Chat: %v", err)
	}
	if response.Content != "chat-ok" || response.Usage.TotalTokens != 5 {
		t.Errorf("Chat response = %+v", response)
	}

	stream, err := a.model.Stream(context.Background(), req)
	if err != nil {
		t.Fatalf("a.model.Stream: %v", err)
	}
	defer stream.Close()
	chunk, err := stream.Recv()
	if err != nil {
		t.Fatalf("Stream Recv: %v", err)
	}
	if chunk.Content != "stream-ok" || !chunk.Finished || chunk.Usage == nil || chunk.Usage.TotalTokens != 5 {
		t.Errorf("Stream chunk = %+v", chunk)
	}
	if _, err := stream.Recv(); !errors.Is(err, llm.ErrStreamEnd) {
		t.Errorf("Stream terminal error = %v, want ErrStreamEnd", err)
	}
	if requests != 2 {
		t.Errorf("provider requests = %d, want 2", requests)
	}
}

func TestPhase2MilestoneRejectsProfileWithMissingPrompt(t *testing.T) {
	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writePhase2Catalog(t, contentRoot, "agents/prompts/missing.md")

	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = contentRoot
	cfg.Content.SchemaRoot = ""
	cfg.Database.URL = "postgres://raptix:raptix@127.0.0.1:1/raptix?sslmode=disable"
	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)

	if _, err := a.content.LoadProfile("recon"); err == nil {
		t.Fatal("LoadProfile(recon) succeeded with a missing prompt reference")
	}
}

func writePhase2Catalog(t *testing.T, root, promptRef string) {
	t.Helper()
	writeFixture(t, root, "agents/prompts/recon-system.md", "You are a recon agent.\n")
	writeFixture(t, root, "agents/profiles/recon.yaml", fmt.Sprintf(`apiVersion: manifest/v1
kind: profile
name: recon
description: recon agent
license: Apache-2.0
promptRefs: [%s]
requested:
  skills: [offensive-osint]
  tools: [nmap]
model: profile-model
`, promptRef))
	writeFixture(t, root, "skills/recon/offensive-osint/SKILL.md", `---
name: offensive-osint
description: OSINT methodology
---

# Offensive OSINT
OSINT guidance body.
`)
	writeFixture(t, root, "tools/manifests/nmap.yaml", `apiVersion: manifest/v1
kind: tool
name: nmap
description: network scanner
version: 1.0.0
executor:
  type: command
  command: nmap
source:
  repo: CyberStrikeAI
  path: tools/nmap.yaml
`)
}

// helper compatible with other _test files in this package.
func writeFixture(t *testing.T, root, rel, body string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}
