import type { RuntimeTransport } from "../adapters/runtime/client.js";
import type { ConversationStore } from "../db/conversation-store.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function messageRole(message: Record<string, unknown>): string | undefined {
  const direct = message.type ?? message.role;
  if (typeof direct === "string") return direct;
  const kwargs = message.kwargs;
  if (isRecord(kwargs)) {
    const nested = kwargs.type ?? kwargs.role;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

function messageField(message: Record<string, unknown>, field: string): unknown {
  if (field in message) return message[field];
  const kwargs = message.kwargs;
  if (isRecord(kwargs) && field in kwargs) return kwargs[field];
  return undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : isRecord(block) && typeof block.text === "string" ? block.text : ""))
      .filter((part) => part.length > 0)
      .join("");
  }
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
}

export interface DerivedExecution {
  id: string;
  conversationId: string;
  conversationTitle: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "completed" | "pending";
  result: string | null;
  createdAt: string | null;
}

/**
 * Pairs every `AIMessage.tool_calls[]` entry in a thread's message history
 * with its matching `ToolMessage` (by `tool_call_id`). Handles both the
 * plain-dict and LangChain `dumpd` ({kwargs: {...}}) message shapes, same
 * as message-extract.ts. A tool call with no matching ToolMessage yet is
 * "pending" (the run hasn't produced a result for it), never fabricated.
 */
export function deriveExecutionsFromMessages(
  messages: unknown[],
  conversationId: string,
  conversationTitle: string,
): DerivedExecution[] {
  const results = new Map<string, { content: string; createdAt: string | null }>();
  for (const raw of messages) {
    if (!isRecord(raw)) continue;
    if (messageRole(raw) !== "tool") continue;
    const callId = messageField(raw, "tool_call_id");
    if (typeof callId !== "string") continue;
    const createdAt = messageField(raw, "created_at") ?? messageField(raw, "createdAt");
    results.set(callId, { content: contentToText(messageField(raw, "content")), createdAt: typeof createdAt === "string" ? createdAt : null });
  }

  const executions: DerivedExecution[] = [];
  for (const raw of messages) {
    if (!isRecord(raw)) continue;
    if (messageRole(raw) !== "ai") continue;
    const toolCalls = messageField(raw, "tool_calls");
    if (!Array.isArray(toolCalls)) continue;
    const createdAt = messageField(raw, "created_at") ?? messageField(raw, "createdAt");
    for (const call of toolCalls) {
      if (!isRecord(call)) continue;
      const id = call.id;
      const name = call.name;
      if (typeof id !== "string" || typeof name !== "string") continue;
      const args = isRecord(call.args) ? call.args : {};
      const matched = results.get(id);
      executions.push({
        id,
        conversationId,
        conversationTitle,
        toolName: name,
        arguments: args,
        status: matched ? "completed" : "pending",
        result: matched ? matched.content : null,
        createdAt: matched?.createdAt ?? (typeof createdAt === "string" ? createdAt : null),
      });
    }
  }
  return executions;
}

/** Scans every known conversation's live thread state and derives its tool-call executions. No caching -- single-operator scale, same posture as agent-loop.routes.ts's task scan. */
export async function listAllExecutions(
  conversationStore: ConversationStore,
  runtime: RuntimeTransport,
): Promise<DerivedExecution[]> {
  const { conversations } = await conversationStore.list({ limit: 10000, offset: 0 });
  const batches = await Promise.all(
    conversations.map(async (conversation) => {
      try {
        const state = await runtime.getThreadState(conversation.runtimeThreadId);
        const messages = Array.isArray(state.values.messages) ? state.values.messages : [];
        return deriveExecutionsFromMessages(messages, conversation.id, conversation.title);
      } catch {
        return [];
      }
    }),
  );
  return batches.flat();
}

export async function findExecutionById(
  id: string,
  conversationStore: ConversationStore,
  runtime: RuntimeTransport,
): Promise<DerivedExecution | null> {
  const all = await listAllExecutions(conversationStore, runtime);
  return all.find((execution) => execution.id === id) ?? null;
}
