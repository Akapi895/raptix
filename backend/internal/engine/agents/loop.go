package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// loop drives the model/tool cycle for one attempt. It returns the result and
// the attempt status; the caller records the outcome. Tool results are fed back
// to the model as user turns because the business llm contract has no tool role.
func (s *Service) loop(ctx context.Context, agent runs.AgentInstance, attempt Attempt, scopeID uuid.UUID, actor string, resolved *contextbuild.Resolved, task string) (AttemptResult, AttemptStatus) {
	systemExtra := s.systemExtra(resolved)
	modelID := resolved.Profile.Model
	if modelID == "" {
		modelID = s.cfg.Model
	}

	seq := 0
	history := make([]llm.ChatMessage, 0)
	evidence := make([]contextbuild.EvidenceRef, 0)
	evidenceIDs := make([]uuid.UUID, 0)
	toolCalls := make([]ToolCall, 0)
	appendTurn := func(role MessageRole, content string, invocationID *uuid.UUID) {
		_, err := s.repo.AppendMessage(ctx, AppendMessageParams{
			AttemptID: attempt.ID, Seq: seq, Role: role, Content: content, InvocationID: invocationID,
		})
		if err != nil {
			s.log.Warn("append agent message failed", "attempt", attempt.ID, "error", err)
		}
		seq++
	}

	// Persist the system prompt and task for traceability.
	initial, err := s.builder.Build(ctx, contextbuild.BuildInput{Resolved: resolved, SystemExtra: systemExtra, Task: task})
	if err != nil {
		s.log.Warn("build initial context failed", "error", err)
		return AttemptResult{}, AttemptFailed
	}
	for _, m := range initial.Messages {
		appendTurn(messageRole(m.Role), m.Content, nil)
	}

	out := AttemptResult{}
	snapshot := func(step int) AttemptResult {
		out.Steps = step
		out.EvidenceIDs = evidenceIDs
		out.ToolCalls = toolCalls
		return out
	}

	for step := 0; step < s.cfg.maxSteps(); step++ {
		if status, done := contextStatus(ctx); done {
			return snapshot(step), status
		}
		built, err := s.builder.Build(ctx, contextbuild.BuildInput{
			Resolved: resolved, SystemExtra: systemExtra, Task: task, History: history, Evidence: evidence,
		})
		if err != nil {
			s.log.Warn("build context failed", "error", err)
			return snapshot(step), AttemptFailed
		}
		resp, err := s.model.Chat(ctx, &llm.ChatRequest{Model: modelID, Messages: built.Messages})
		if err != nil {
			if status, done := contextStatus(ctx); done {
				return snapshot(step), status
			}
			s.log.Warn("model call failed", "agent", agent.ID, "error", err)
			return snapshot(step), AttemptFailed
		}
		content := strings.TrimSpace(resp.Content)
		if content == "" {
			s.log.Warn("model returned empty content", "agent", agent.ID)
			return snapshot(step), AttemptFailed
		}
		act, err := parseAction(content)
		if err != nil {
			appendTurn(RoleAssistant, content, nil)
			s.log.Warn("model action could not be parsed", "agent", agent.ID, "error", err)
			return snapshot(step + 1), AttemptFailed
		}
		appendTurn(RoleAssistant, content, nil)

		switch act.Action {
		case "tool":
			inv, res, err := s.dispatchTool(ctx, agent, attempt, scopeID, actor, step, act)
			if err != nil {
				appendTurn(RoleTool, "tool error: "+err.Error(), nil)
				if status, done := contextStatus(ctx); done {
					return snapshot(step + 1), status
				}
				return snapshot(step + 1), AttemptFailed
			}
			summary := summarizeResult(act.Capability, res)
			var invID *uuid.UUID
			if inv.ID != uuid.Nil {
				id := inv.ID
				invID = &id
			}
			appendTurn(RoleTool, summary, invID)
			history = append(history,
				llm.ChatMessage{Role: llm.RoleAssistant, Content: content},
				llm.ChatMessage{Role: llm.RoleUser, Content: summary},
			)
			toolCalls = append(toolCalls, ToolCall{
				Capability: act.Capability, Args: act.Args, InvocationID: inv.ID,
				Execution: string(res.Execution), RawRef: res.RawRef,
			})
			if res.Execution == output.ExecutionDenied {
				out.Summary = "capability denied: " + summary
				return snapshot(step + 1), AttemptFailed
			}
			if res.RawRef != "" {
				if id, err := uuid.Parse(res.RawRef); err == nil {
					evidenceIDs = append(evidenceIDs, id)
					evidence = append(evidence, contextbuild.EvidenceRef{ID: res.RawRef, Summary: summary})
				}
			}
		case "final":
			out.Summary = act.Summary
			out.Draft = mapDraft(act.FindingDraft)
			return snapshot(step + 1), AttemptSucceeded
		default:
			s.log.Warn("model returned unknown action", "agent", agent.ID, "action", act.Action)
			return snapshot(step + 1), AttemptFailed
		}
	}
	out.Summary = "step budget exhausted"
	return snapshot(s.cfg.maxSteps()), AttemptFailed
}

// contextStatus maps a finished context to an attempt status.
func contextStatus(ctx context.Context) (AttemptStatus, bool) {
	switch ctx.Err() {
	case context.DeadlineExceeded:
		return AttemptTimedOut, true
	case context.Canceled:
		return AttemptCancelled, true
	default:
		return "", false
	}
}

// systemExtra is the fixed instruction describing the action protocol and the
// capabilities the agent may request.
func (s *Service) systemExtra(resolved *contextbuild.Resolved) []string {
	var b strings.Builder
	b.WriteString("Respond with a single JSON object and nothing else.\n")
	b.WriteString("To run a capability: {\"action\":\"tool\",\"capability\":\"<name>\",\"args\":{...}}\n")
	b.WriteString("To finish: {\"action\":\"final\",\"summary\":\"...\",\"finding_draft\":{\"title\":\"...\",\"description\":\"...\",\"severity\":\"low|medium|high|critical\",\"confidence\":\"low|medium|high\"}}\n")
	b.WriteString("Only request capabilities you have been granted; a denied request will end the attempt.")
	if tools := s.availableTools(resolved); len(tools) > 0 {
		b.WriteString("\nAvailable capabilities: ")
		b.WriteString(strings.Join(tools, ", "))
	}
	return []string{b.String()}
}

// availableTools lists the profile's requested tools that have a runnable
// implementation. Availability is not permission.
func (s *Service) availableTools(resolved *contextbuild.Resolved) []string {
	if s.resolver == nil {
		return nil
	}
	out := make([]string, 0, len(resolved.Profile.Requested.Tools))
	for _, t := range resolved.Profile.Requested.Tools {
		if s.resolver.Available(t) {
			out = append(out, t)
		}
	}
	return out
}

// parseAction extracts the first JSON object from a model reply and decodes it.
// Prose or code fences around the object are tolerated; a malformed reply is an
// error, not a crash.
func parseAction(content string) (action, error) {
	trimmed := strings.TrimSpace(content)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(strings.TrimSpace(trimmed), "```")
	start := strings.Index(trimmed, "{")
	if start < 0 {
		return action{}, fmt.Errorf("model response contains no JSON object")
	}
	var a action
	if err := json.NewDecoder(strings.NewReader(trimmed[start:])).Decode(&a); err != nil {
		return action{}, fmt.Errorf("decode action: %w", err)
	}
	if strings.TrimSpace(a.Action) == "" {
		return action{}, fmt.Errorf("action field is required")
	}
	return a, nil
}

func mapDraft(d *findingDraft) *FindingDraft {
	if d == nil {
		return nil
	}
	return &FindingDraft{Title: d.Title, Description: d.Description, Severity: d.Severity, Confidence: d.Confidence}
}

func messageRole(r llm.Role) MessageRole {
	switch r {
	case llm.RoleSystem:
		return RoleSystem
	case llm.RoleAssistant:
		return RoleAssistant
	default:
		return RoleUser
	}
}
