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

/** The top-level orchestrator graph; apps/ui-app's execution.ts treats this as the run's main agent. */
const MAIN_AGENT = "raptix";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Translates one raw LangGraph message chunk from the orchestrator's own
 * stream (standard LangChain AIMessage/ToolMessage shape -- apps/api adds
 * no server-side wrapping) into apps/ui-app's execution-tree envelope
 * (features/chat/workspace/execution.ts's einoAgent/toolName/toolCallId/
 * argumentsObj convention). `seenCalls` dedups tool_calls across the
 * repeated partial chunks one AI message streams as.
 *
 * Only the top-level stream is ever seen here (runs start with
 * `subgraphs: false`), so this captures delegation (`task(subagent_type, ...)`)
 * and the orchestrator's own direct tool calls, never a dispatched
 * specialist's own internal tool calls -- the same scope execution.ts's
 * parser already assumes (main agent + its `task` children).
 */
export function captureExecutionEvents(chunk: unknown, seenCalls: Set<string>): MessageEventInput[] {
  const message = record(chunk) as RawMessageChunk;
  const events: MessageEventInput[] = [];
  if (message.type === "ai" && Array.isArray(message.tool_calls)) {
    for (const raw of message.tool_calls) {
      const call = record(raw) as RawToolCall;
      const id = asString(call.id);
      if (!id || seenCalls.has(id)) continue;
      seenCalls.add(id);
      events.push({
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
