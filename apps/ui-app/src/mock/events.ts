// Backend SSE envelopes used by the scripted runs. Transport accepts a generic
// envelope, while producers must supply the exact data for each event name.
export interface RunEventData {
  conversation: { conversationId: string };
  message_saved: { userMessageId: string };
  progress: { stage: string; mode: string };
  iteration: { iteration: number; mode: string };
  thinking: { iteration: number };
  error: { retryable: boolean };
  done: { status: string; workflowStatus?: string };
  knowledge_retrieval: { hits: number };
  tool_calls_detected: { count: number };
  tool_call: { toolName: string; toolCallId: string; index: number; total: number; arguments: { target: string; ports: string } | { query: string } };
  hitl_interrupt: { interruptId: string; toolName: string; toolCallId: string; arguments: { endpoint: string; attempts: number }; reason: string; status: string; reviewer: string };
  cancelled: Record<string, never>;
  hitl_rejected: { interruptId: string; decision: 'reject' };
  hitl_resumed: { interruptId: string; decision: 'approve' };
  tool_result: { toolName: string; toolCallId: string; success: boolean; executionId: string; durationMs: number };
  response_start: { mode: string };
  response_delta: { delta: string };
  response: { mcpExecutionIds: string[]; messageId: string; finalized: boolean; finalizable: boolean; completionReason: string; evidenceVerified: boolean; missingChecks: string[] };
}
export type RunEvent = { [K in keyof RunEventData]: { type: K; message: string; data: RunEventData[K] & { conversationId: string } } }[keyof RunEventData];
