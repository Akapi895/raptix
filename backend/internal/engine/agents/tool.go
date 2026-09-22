package agents

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// dispatchTool requests a capability through execution. The idempotency key is
// derived from the attempt and step so a retried loop cannot run the same tool
// twice. Permission, scope, run state and budget are checked by execution.
func (s *Service) dispatchTool(ctx context.Context, agent runs.AgentInstance, attempt Attempt, scopeID uuid.UUID, actor string, step int, act action) (invocation.Invocation, *output.Result, error) {
	capability := strings.TrimSpace(act.Capability)
	if capability == "" {
		return invocation.Invocation{}, nil, fmt.Errorf("tool action requires a capability")
	}
	inv, res, err := s.exec.InvokeCapability(ctx, invocation.InvokeParams{
		RunID:          agent.RunID,
		TaskID:         agent.TaskID,
		ScopeID:        scopeID,
		Actor:          actor,
		Capability:     capability,
		Args:           act.Args,
		IdempotencyKey: fmt.Sprintf("%s:%d", attempt.ID, step),
	})
	if err != nil {
		return inv, res, err
	}
	if res == nil {
		return inv, nil, fmt.Errorf("capability %s returned no result", capability)
	}
	return inv, res, nil
}

// summarizeResult renders a short, model-readable summary of a tool result. It
// is a context view: it references the raw artifact but does not reproduce it.
func summarizeResult(capability string, res *output.Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s -> execution=%s", capability, res.Execution)
	if res.RawRef != "" {
		fmt.Fprintf(&b, " raw=%s", res.RawRef)
	}
	if res.StructuredRef != "" {
		fmt.Fprintf(&b, " structured=%s", res.StructuredRef)
	}
	if res.ExitCode != nil {
		fmt.Fprintf(&b, " exit=%d", *res.ExitCode)
	}
	if res.Error != nil {
		fmt.Fprintf(&b, " error=%s", res.Error.Message)
	}
	for _, d := range res.Diagnostics {
		fmt.Fprintf(&b, " [%s] %s", d.Level, d.Message)
	}
	return b.String()
}
