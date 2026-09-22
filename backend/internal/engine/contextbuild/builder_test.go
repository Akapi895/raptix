package contextbuild

import (
	"context"
	"strings"
	"testing"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

type fakeSource struct {
	profile *content.Profile
	prompts map[string]string
	skills  map[string]*content.Skill
}

func (f *fakeSource) LoadProfile(name string) (*content.Profile, error) { return f.profile, nil }
func (f *fakeSource) LoadPrompt(ref string) (string, error)             { return f.prompts[ref], nil }
func (f *fakeSource) LoadSkill(name string) (*content.Skill, error)     { return f.skills[name], nil }

func newSource() *fakeSource {
	p := &content.Profile{Model: "m"}
	p.Name = "recon"
	p.Description = "recon agent"
	p.Version = "1.0.0"
	p.PromptRefs = []string{"agents/prompts/recon-system.md"}
	p.Requested.Skills = []string{"osint"}
	skill := &content.Skill{Body: "OSINT guidance."}
	skill.Name = "osint"
	return &fakeSource{
		profile: p,
		prompts: map[string]string{"agents/prompts/recon-system.md": "You are recon."},
		skills:  map[string]*content.Skill{"osint": skill},
	}
}

func TestResolveLoadsPromptsSkillsAndHash(t *testing.T) {
	b := NewBuilder(newSource(), Budget{})
	r, err := b.Resolve(context.Background(), "recon")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Prompts) != 1 || len(r.Skills) != 1 {
		t.Fatalf("resolved = %+v", r)
	}
	if !strings.HasPrefix(r.ContentHash, "sha256:") {
		t.Errorf("hash = %q", r.ContentHash)
	}
	// Deterministic hash for identical content.
	r2, _ := b.Resolve(context.Background(), "recon")
	if r.ContentHash != r2.ContentHash {
		t.Errorf("hash not deterministic: %s != %s", r.ContentHash, r2.ContentHash)
	}
}

func TestBuildOrderAndProvenance(t *testing.T) {
	b := NewBuilder(newSource(), Budget{})
	resolved, _ := b.Resolve(context.Background(), "recon")
	out, err := b.Build(context.Background(), BuildInput{
		Resolved:    resolved,
		SystemExtra: []string{"Reply with JSON."},
		Task:        "scan example.test",
		History:     []llm.ChatMessage{{Role: llm.RoleAssistant, Content: "prior"}},
		Evidence:    []EvidenceRef{{ID: "art-1", Summary: "200 OK"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	msgs := out.Messages
	if len(msgs) != 3 {
		t.Fatalf("messages = %d, want 3 (system, history, task)", len(msgs))
	}
	if msgs[0].Role != llm.RoleSystem || msgs[1].Role != llm.RoleAssistant || msgs[2].Role != llm.RoleUser {
		t.Fatalf("roles = %v %v %v", msgs[0].Role, msgs[1].Role, msgs[2].Role)
	}
	sys := msgs[0].Content
	for _, want := range []string{"recon agent", "You are recon.", "OSINT guidance.", "Reply with JSON.", "art-1"} {
		if !strings.Contains(sys, want) {
			t.Errorf("system prompt missing %q:\n%s", want, sys)
		}
	}
	if msgs[2].Content != "scan example.test" {
		t.Errorf("task = %q", msgs[2].Content)
	}
}

func TestBuildDropsOldestHistoryUnderBudget(t *testing.T) {
	b := NewBuilder(newSource(), Budget{MaxTokens: 60})
	resolved, _ := b.Resolve(context.Background(), "recon")
	history := []llm.ChatMessage{
		{Role: llm.RoleUser, Content: strings.Repeat("a", 200)},
		{Role: llm.RoleAssistant, Content: strings.Repeat("b", 200)},
		{Role: llm.RoleUser, Content: strings.Repeat("c", 200)},
	}
	out, err := b.Build(context.Background(), BuildInput{Resolved: resolved, Task: "go", History: history})
	if err != nil {
		t.Fatal(err)
	}
	if !out.Truncated {
		t.Error("expected Truncated")
	}
	if out.EstimatedTokens > 60 {
		t.Errorf("estimated tokens = %d, want <= 60", out.EstimatedTokens)
	}
	if out.Messages[0].Role != llm.RoleSystem {
		t.Error("system prompt must be preserved")
	}
	if out.Messages[len(out.Messages)-1].Content != "go" {
		t.Error("task must be preserved")
	}
}

func TestBuildNoBudgetKeepsEverything(t *testing.T) {
	b := NewBuilder(newSource(), Budget{})
	resolved, _ := b.Resolve(context.Background(), "recon")
	out, err := b.Build(context.Background(), BuildInput{Resolved: resolved, Task: "t"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Truncated {
		t.Error("did not expect truncation without a budget")
	}
}
