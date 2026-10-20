"""SubagentTranscriptState: the orchestrator state base.

Sub-agent activity (start / message / tool_call / tool_result / end) is still emitted live by
:class:`raptix.core.subagent_streaming.StreamingRunnable` as custom events for an attached SSE client. Its durable
copy no longer lives in the graph state: :class:`raptix.execution.session.transcript_sidecar.DurableTranscript`
appends every event to a per-thread sidecar as it happens, so each checkpoint stays small (checkpoint state slimming,
option E; design in ``docs/design/2026-10-20-checkpoint-state-slimming-design.md``).

The class is kept, with no channels of its own, so the state chain ``DispatchState -> SubagentTranscriptState ->
AgentState`` does not change for the rest of the runtime.
"""

from __future__ import annotations

from langchain.agents import AgentState


class SubagentTranscriptState(AgentState):
    """Orchestrator state base. Adds no channels; transcripts live in the sidecar."""
