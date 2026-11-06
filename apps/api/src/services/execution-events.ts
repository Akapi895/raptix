import type { MessageEventInput } from "../db/message-event-store.js";

interface RawToolCall {
  id?: unknown;
  name?: unknown;
  args?: unknown;
}

interface RawMessageChunk {
  type?: unknown;
  tool_call_id?: unknown;
  name?: unknown;
  status?: unknown;
  tool_calls?: unknown;
}

interface RawChildEvent {
  type?: unknown;
  agent?: unknown;
  parent_tool_call_id?: unknown;
  session_id?: unknown;
  prompt?: unknown;
  text?: unknown;
  tool?: unknown;
  args?: unknown;
  id?: unknown;
  content?: unknown;
  status?: unknown;
  cancelled?: unknown;
  error?: unknown;
}

/**
 * raptix.core.subagent_streaming's event "type" -> apps/ui-app's
 * processDetails eventType, kept distinct from the orchestrator's own
 * tool_call/tool_result/progress so execution.ts's status machine (keyed off
 * those exact strings) never mistakes a child's internal activity for its
 * own delegation lifecycle.
 */
const CHILD_EVENT_TYPES: Readonly<Record<string, string>> = {
  subagent_start: "child_start",
  subagent_message: "child_message",
  subagent_tool_call: "child_tool_call",
  subagent_tool_result: "child_tool_result",
  subagent_end: "child_end",
};

/** The top-level orchestrator graph; apps/ui-app's execution.ts treats this as the run's main agent. */
const MAIN_AGENT = "raptix";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A tool call's arguments arrive as a growing JSON string across many
 * "messages/partial" chunks of the same AI message (langgraph_api's own
 * stream.py: an AI message only ever yields "messages/partial" while
 * streaming -- "messages/complete" is reserved for message types that
 * never chunk, like ToolMessage). The first chunk for a call id is
 * typically `{}`, well before the args are parseable. `pending` tracks
 * the latest snapshot per call id; nothing is emitted until `commit` is
 * called at a graph step boundary, by which point the model has moved on
 * and the args are as complete as they're going to get.
 */
export interface ToolCallBuffer {
  pending: Map<string, MessageEventInput>;
  committed: Set<string>;
}

export function createToolCallBuffer(): ToolCallBuffer {
  return { pending: new Map(), committed: new Set() };
}

/** Finalizes every tool_call buffered since the last commit, in first-seen order. */
export function commitPendingToolCalls(buffer: ToolCallBuffer): MessageEventInput[] {
  const events = [...buffer.pending.values()];
  for (const event of events) {
    const id = asString((event.data as { toolCallId?: unknown }).toolCallId);
    if (id) buffer.committed.add(id);
  }
  buffer.pending.clear();
  return events;
}

/**
 * Translates one raw LangGraph message chunk from the orchestrator's own
 * stream (standard LangChain AIMessage/ToolMessage shape -- apps/api adds
 * no server-side wrapping) into apps/ui-app's execution-tree envelope
 * (features/chat/workspace/execution.ts's einoAgent/toolName/toolCallId/
 * argumentsObj convention). A tool_call is buffered (see `ToolCallBuffer`)
 * rather than returned directly; `commitPendingToolCalls` is what actually
 * emits it. A tool_result (from a ToolMessage, never chunked) is complete
 * the moment it's seen, so it's returned immediately.
 *
 * Only the top-level stream is ever seen here (runs start with
 * `subgraphs: false`), so this captures delegation (`task(subagent_type, ...)`)
 * and the orchestrator's own direct tool calls, never a dispatched
 * specialist's own internal tool calls -- the same scope execution.ts's
 * parser already assumes (main agent + its `task` children).
 */
export function captureExecutionEvents(chunk: unknown, buffer: ToolCallBuffer): MessageEventInput[] {
  const message = record(chunk) as RawMessageChunk;
  const events: MessageEventInput[] = [];
  if (message.type === "ai" && Array.isArray(message.tool_calls)) {
    for (const raw of message.tool_calls) {
      const call = record(raw) as RawToolCall;
      const id = asString(call.id);
      if (!id || buffer.committed.has(id)) continue;
      buffer.pending.set(id, {
        eventType: "tool_call",
        data: { einoAgent: MAIN_AGENT, einoRole: "orchestrator", toolName: asString(call.name), toolCallId: id, argumentsObj: record(call.args) },
      });
    }
  }
  if (message.type === "tool" && typeof message.tool_call_id === "string") {
    events.push({
      eventType: "tool_result",
      data: { toolCallId: message.tool_call_id, toolName: asString(message.name), isError: message.status === "error", success: message.status !== "error" },
    });
  }
  return events;
}

/**
 * Translates one "custom" stream-mode chunk -- a dispatched specialist's own
 * subagent_start/message/tool_call/tool_result/end event, emitted through
 * raptix.core.subagent_streaming's get_stream_writer() channel -- into
 * apps/ui-app's execution-tree envelope. Unlike captureExecutionEvents, these
 * events are fully formed the moment they're seen (the child's own stream
 * already yields complete message state, never growing partial chunks), so
 * there is nothing to buffer.
 *
 * `parentToolCallId` is the orchestrator's own task() tool_call id (threaded
 * through DispatchContext.tool_call_id server-side) -- the same id
 * execution.ts uses as a delegated ExecutionAgent's identity. It is what
 * lets the UI route a child's own activity back to the exact row that
 * dispatched it, even when several dispatches share the same specialist name.
 */
export function captureChildEvents(chunk: unknown): MessageEventInput[] {
  const raw = record(chunk) as RawChildEvent;
  const eventType = CHILD_EVENT_TYPES[asString(raw.type)];
  const einoAgent = asString(raw.agent);
  if (!eventType || !einoAgent) return [];
  const base = {
    einoAgent,
    parentToolCallId: asString(raw.parent_tool_call_id) || null,
    sessionId: asString(raw.session_id) || null,
  };
  switch (eventType) {
    case "child_start":
      return [{ eventType, data: { ...base, prompt: asString(raw.prompt) } }];
    case "child_message":
      return [{ eventType, data: { ...base, text: asString(raw.text) } }];
    case "child_tool_call":
      return [{
        eventType,
        data: { ...base, toolName: asString(raw.tool), toolCallId: asString(raw.id) || null, argumentsObj: record(raw.args) },
      }];
    case "child_tool_result":
      return [{
        eventType,
        data: {
          ...base,
          toolName: asString(raw.tool),
          toolCallId: asString(raw.id) || null,
          content: typeof raw.content === "string" ? raw.content : "",
          isError: raw.status === "error",
          success: raw.status !== "error",
        },
      }];
    case "child_end":
      return [{ eventType, data: { ...base, cancelled: raw.cancelled === true, error: raw.error === true } }];
    default:
      return [];
  }
}
