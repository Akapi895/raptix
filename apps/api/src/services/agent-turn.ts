import { randomUUID } from "node:crypto";
import type { RuntimeRun, RuntimeTransport } from "../adapters/runtime/client.js";
import { extractLastAssistantText } from "../adapters/runtime/message-extract.js";
import type { ConversationStore } from "../db/conversation-store.js";

export const TERMINAL_RUN_STATUSES = new Set(["success", "error", "timeout", "interrupted"]);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentTurnResult {
  status: string;
  response: string;
  finalized: boolean;
}

/**
 * One turn of the chat loop: append the user message, create a run, poll it
 * to a terminal status (bounded wait), extract and append the assistant's
 * reply. Shared by POST /api/eino-agent (agent-loop.routes.ts) and the
 * batch task processor (batch-tasks.routes.ts) -- both dispatch a message
 * the same way, so there is exactly one place that knows how.
 */
export async function runAgentTurn(args: {
  conversation: { id: string; runtimeThreadId: string; roleName: string | null };
  message: string;
  runtime: RuntimeTransport;
  conversationStore: ConversationStore;
  defaultAssistantId: string;
  waitMs: number;
}): Promise<AgentTurnResult> {
  const { conversation, message, runtime, conversationStore, defaultAssistantId, waitMs } = args;

  await conversationStore.appendMessage(conversation.id, "user", message);

  const assistantId = conversation.roleName ?? defaultAssistantId;
  let run: RuntimeRun = await runtime.createRun(
    conversation.runtimeThreadId,
    assistantId,
    { messages: [{ role: "user", content: message }] },
    randomUUID(),
  );

  const deadline = Date.now() + waitMs;
  while (!TERMINAL_RUN_STATUSES.has(run.status) && Date.now() < deadline) {
    await sleep(500);
    run = await runtime.getRun(conversation.runtimeThreadId, run.runId);
  }

  if (!TERMINAL_RUN_STATUSES.has(run.status)) {
    return { status: "running", response: "The agent is still working on this.", finalized: false };
  }
  if (run.status !== "success") {
    return { status: run.status, response: `The run ended with status "${run.status}".`, finalized: true };
  }

  const state = await runtime.getThreadState(conversation.runtimeThreadId);
  const answer = extractLastAssistantText(state.values);
  if (answer !== null) await conversationStore.appendMessage(conversation.id, "assistant", answer);
  return {
    status: run.status,
    response: answer ?? "The run finished, but no assistant message could be extracted from the runtime state.",
    finalized: true,
  };
}
