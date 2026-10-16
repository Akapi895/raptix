# Restore tool activity from owned checkpoint messages

**Status: Proposed** · 2026-10-16

## Context

The M1 Execution page needs durable root-tool activity after refresh. Existing
transcript reads only project custom subagent events, so ordinary root filesystem
calls disappear from that view despite being retained in checkpoints.

## Decision

`ThreadHistoryEvent.payload` also accepts the existing public `ToolPayload` union.
Root tools are projected through the same bounded/redacted stream projection used
for live messages. Ordinary chat is excluded. Every retained entry remains
`source: checkpoint`, `runId: null`; checkpoint messages cannot prove current-run
attribution. Existing custom transcript entries and provenance keys are retained.

## Consequences

This is an additive payload extension, not a new execution ledger. Clients narrow
the union before reading agent-specific fields. Limits/truncation remain visible.
An inspector cannot infer policy approval, timestamps or parent/run attribution
that the checkpoint source does not provide.
