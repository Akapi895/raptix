# Preserve tool identity and require explicit Web bash decisions

**Status: Proposed** · 2026-10-16

## Context

M1 live verification produced a real HITL request with empty argument metadata.
Current LangChain exposes `ToolCallRequest.tool_call`; the middleware still reads
legacy `tool_call_args`/`tool_call_id`. The default bash rule is informational and
allows on timeout, so it cannot certify an explicitly approved Web execution.

## Decision

Read modern args/IDs from `tool_call`, retaining legacy compatibility. Denials and
redirects preserve the original call identity. Existing redaction applies before
metadata leaves the runtime. The Web profile opts into
`RAPTIX_HITL__REQUIRE_BASH_APPROVAL=1`: its bash rule denies on timeout and waits
up to 300 seconds for a real operator decision. Other default policies are unchanged.

## Threat model and consequences

An operator must inspect the actual redacted invocation before authorizing it;
empty args and detached denial IDs break that boundary. This change strengthens
the Web timeout policy, does not bypass RoE/egress/SafeCommand, and neither replaces
nor disables any safety-critical slot. Approval still cannot authorize out-of-scope
work. The stricter profile can leave work waiting when no operator is present;
expiration denies it rather than silently executing it.
