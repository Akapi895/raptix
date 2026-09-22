// Package contextbuild assembles the model context for an agent attempt from
// the profile prompt, selected skills, conversation history and evidence
// references, under a token budget. It reads content that has already been
// resolved (it never grants access and never mutates raw evidence) and records
// provenance so a snapshot can be traced back to the exact content used.
package contextbuild

import (
	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

// SkillDoc is a skill's guidance body selected into context. Metadata-first
// discovery happens in the loader; only the body selected for context appears
// here.
type SkillDoc struct {
	Name string
	Body string
}

// EvidenceRef is a reference to evidence the agent may reason about. Summary is
// a context view derived from the artifact; the raw bytes stay in evidence.
type EvidenceRef struct {
	ID      string
	Summary string
}

// Resolved is the immutable content selected for one agent, with a hash over
// exactly what was resolved so a snapshot can dedupe and be audited.
type Resolved struct {
	Profile     *content.Profile
	Prompts     []string
	Skills      []SkillDoc
	ContentHash string
}

// BuildInput is the material for one context assembly. History is the
// conversation so far (assistant/tool turns); Task is the user instruction for
// the attempt.
type BuildInput struct {
	Resolved    *Resolved
	SystemExtra []string
	Task        string
	History     []llm.ChatMessage
	Evidence    []EvidenceRef
}

// Budget bounds the assembled context. MaxTokens <= 0 disables enforcement.
type Budget struct {
	MaxTokens int
}

// BuildResult is the assembled context plus provenance about budget handling.
type BuildResult struct {
	Messages        []llm.ChatMessage
	EstimatedTokens int
	Truncated       bool
}
