package contextbuild

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
)

// PromptSource resolves profile, prompt and skill content. content.Loader
// satisfies it.
type PromptSource interface {
	LoadProfile(name string) (*content.Profile, error)
	LoadPrompt(ref string) (string, error)
	LoadSkill(name string) (*content.Skill, error)
}

// Builder assembles context under a budget from already-authorized content.
type Builder struct {
	source PromptSource
	budget Budget
}

// NewBuilder wires a builder over a content source and a token budget.
func NewBuilder(source PromptSource, budget Budget) *Builder {
	return &Builder{source: source, budget: budget}
}

// Resolve loads the profile, its prompt bodies and the requested skill bodies,
// and computes a content hash over exactly what was resolved. Skills are loaded
// at the body level only for those selected here; selecting a skill never grants
// execution rights.
func (b *Builder) Resolve(ctx context.Context, profileName string) (*Resolved, error) {
	if b.source == nil {
		return nil, fmt.Errorf("contextbuild has no content source")
	}
	profile, err := b.source.LoadProfile(profileName)
	if err != nil {
		return nil, fmt.Errorf("load profile %s: %w", profileName, err)
	}
	prompts := make([]string, 0, len(profile.PromptRefs))
	for _, ref := range profile.PromptRefs {
		body, err := b.source.LoadPrompt(ref)
		if err != nil {
			return nil, fmt.Errorf("load prompt %s: %w", ref, err)
		}
		prompts = append(prompts, body)
	}
	skills := make([]SkillDoc, 0, len(profile.Requested.Skills))
	for _, name := range profile.Requested.Skills {
		skill, err := b.source.LoadSkill(name)
		if err != nil {
			return nil, fmt.Errorf("load skill %s: %w", name, err)
		}
		skills = append(skills, SkillDoc{Name: skill.Name, Body: skill.Body})
	}
	return &Resolved{
		Profile:     profile,
		Prompts:     prompts,
		Skills:      skills,
		ContentHash: hashResolved(profileName, profile.Version, prompts, skills),
	}, nil
}

// Build assembles the message list: a system prompt (profile + prompts + skills
// + extra instructions + evidence references), then the conversation history,
// then the task as the final user turn. When the estimate exceeds the budget it
// drops the oldest history turns first, keeping the system prompt and the task;
// if it still overflows it truncates the system prompt and reports Truncated.
func (b *Builder) Build(ctx context.Context, in BuildInput) (BuildResult, error) {
	if in.Resolved == nil || in.Resolved.Profile == nil {
		return BuildResult{}, fmt.Errorf("build input requires a resolved profile")
	}

	system := b.systemPrompt(in)
	messages := make([]llm.ChatMessage, 0, len(in.History)+2)
	messages = append(messages, llm.ChatMessage{Role: llm.RoleSystem, Content: system})
	messages = append(messages, in.History...)
	if strings.TrimSpace(in.Task) != "" {
		messages = append(messages, llm.ChatMessage{Role: llm.RoleUser, Content: in.Task})
	}

	result := BuildResult{Messages: messages}
	result.EstimatedTokens = estimateMessages(messages)
	if b.budget.MaxTokens <= 0 || result.EstimatedTokens <= b.budget.MaxTokens {
		return result, nil
	}

	// Drop the oldest history turns (indices 1..len-1 excluding the final task)
	// until the estimate fits, then truncate the system prompt if still over.
	trimmed, dropped := dropOldestHistory(messages, b.budget.MaxTokens)
	if dropped {
		result.Truncated = true
	}
	if estimateMessages(trimmed) > b.budget.MaxTokens {
		trimmed = truncateSystem(trimmed, b.budget.MaxTokens)
		result.Truncated = true
	}
	result.Messages = trimmed
	result.EstimatedTokens = estimateMessages(trimmed)
	return result, nil
}

// systemPrompt renders the system message from resolved content plus any extra
// instructions and evidence references.
func (b *Builder) systemPrompt(in BuildInput) string {
	var sb strings.Builder
	if desc := strings.TrimSpace(in.Resolved.Profile.Description); desc != "" {
		sb.WriteString("# Role\n")
		sb.WriteString(desc)
		sb.WriteString("\n")
	}
	for _, p := range in.Resolved.Prompts {
		if strings.TrimSpace(p) == "" {
			continue
		}
		sb.WriteString("\n")
		sb.WriteString(strings.TrimSpace(p))
		sb.WriteString("\n")
	}
	for _, s := range in.Resolved.Skills {
		sb.WriteString("\n# Skill: ")
		sb.WriteString(s.Name)
		sb.WriteString("\n")
		sb.WriteString(strings.TrimSpace(s.Body))
		sb.WriteString("\n")
	}
	for _, extra := range in.SystemExtra {
		if strings.TrimSpace(extra) == "" {
			continue
		}
		sb.WriteString("\n")
		sb.WriteString(strings.TrimSpace(extra))
		sb.WriteString("\n")
	}
	if len(in.Evidence) > 0 {
		sb.WriteString("\n# Evidence available\n")
		for _, e := range in.Evidence {
			sb.WriteString("- [")
			sb.WriteString(e.ID)
			sb.WriteString("] ")
			sb.WriteString(strings.TrimSpace(e.Summary))
			sb.WriteString("\n")
		}
	}
	return strings.TrimSpace(sb.String())
}

// dropOldestHistory removes history turns from the front of the conversation
// while the estimate exceeds max, never removing the system prompt or the final
// task turn. It reports whether anything was removed.
func dropOldestHistory(messages []llm.ChatMessage, max int) ([]llm.ChatMessage, bool) {
	if len(messages) <= 2 {
		return messages, false
	}
	// Keep index 0 (system). The final message may be the task; treat it as
	// pinned when it is a user turn.
	pinnedTail := 0
	if messages[len(messages)-1].Role == llm.RoleUser {
		pinnedTail = 1
	}
	historyStart, historyEnd := 1, len(messages)-pinnedTail
	dropped := false
	for historyStart < historyEnd && estimateMessages(messages) > max {
		historyStart++
		dropped = true
	}
	if !dropped {
		return messages, false
	}
	out := make([]llm.ChatMessage, 0, 1+(historyEnd-historyStart)+pinnedTail)
	out = append(out, messages[0])
	out = append(out, messages[historyStart:historyEnd]...)
	if pinnedTail == 1 {
		out = append(out, messages[len(messages)-1])
	}
	return out, true
}

// truncateSystem shortens the system prompt until the estimate fits, preserving
// the tail of the prompt (the most specific instructions) is unnecessary; a
// leading marker records that content was cut.
func truncateSystem(messages []llm.ChatMessage, max int) []llm.ChatMessage {
	out := append([]llm.ChatMessage{}, messages...)
	if len(out) == 0 {
		return out
	}
	const marker = "\n\n[context truncated to fit budget]"
	others := estimateMessages(out[1:])
	allow := max - others - estimateTokens(marker)
	if allow < 0 {
		allow = 0
	}
	runes := []rune(out[0].Content)
	keep := allow * 4
	if keep < 0 {
		keep = 0
	}
	if keep < len(runes) {
		out[0].Content = string(runes[:keep]) + marker
	}
	return out
}

func estimateMessages(messages []llm.ChatMessage) int {
	total := 0
	for _, m := range messages {
		total += estimateTokens(m.Content)
	}
	return total
}

// estimateTokens approximates tokens from bytes; providers differ, so the
// budget is a guardrail, not an exact accounting.
func estimateTokens(s string) int {
	return (len(s) + 3) / 4
}

func hashResolved(profileName, version string, prompts []string, skills []SkillDoc) string {
	h := sha256.New()
	fmt.Fprintf(h, "profile:%s@%s\n", profileName, version)
	for _, p := range prompts {
		fmt.Fprintf(h, "prompt:%s\n", p)
	}
	for _, s := range skills {
		fmt.Fprintf(h, "skill:%s\n%s\n", s.Name, s.Body)
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}
