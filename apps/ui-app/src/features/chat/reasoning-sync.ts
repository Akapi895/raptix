export interface ReasoningSyncPorts {
  conversationId(): string;
  request(path: string): Promise<Response>;
  setReasoning(domId: string, reasoning: unknown): void;
  /** The paginated loader of the process details, when the page has it. */
  loadPaginated?(domId: string, backendId: string): Promise<unknown> | undefined;
  renderDetails(domId: string, details: unknown[]): void;
  warn(message: string, error: unknown): void;
}

/**
 * Once the final reply has arrived, its reasoning and its full process details are read from the server. The process details are read
 * in full: a call without parameters returns only the first page and would overwrite the timeline restored from the task events.
 */
export async function syncAssistantReasoningContent(ports: ReasoningSyncPorts, backendMessageId: string, domAssistantId: string): Promise<void> {
  const conversationId = ports.conversationId();
  if (!backendMessageId || !domAssistantId || !conversationId) return;
  try {
    const convRes = await ports.request(`/api/conversations/${encodeURIComponent(conversationId)}?include_process_details=0`);
    const conv = await convRes.json().catch(() => ({}));
    if (!convRes.ok || !Array.isArray(conv.messages)) return;
    const msg = conv.messages.find((m: { id?: unknown; reasoningContent?: unknown } | null) => m && String(m.id) === String(backendMessageId));
    if (!msg || !msg.reasoningContent) return;
    ports.setReasoning(domAssistantId, msg.reasoningContent);
    const paginated = ports.loadPaginated?.(domAssistantId, String(backendMessageId));
    if (paginated) {
      await paginated;
      return;
    }
    const pdRes = await ports.request(`/api/messages/${encodeURIComponent(String(backendMessageId))}/process-details?full=1`);
    const pdJson = await pdRes.json().catch(() => ({}));
    const details = pdRes.ok && Array.isArray(pdJson.processDetails) ? pdJson.processDetails : [];
    ports.renderDetails(domAssistantId, details);
  } catch (error) {
    ports.warn('syncAssistantReasoningContentFromServer failed', error);
  }
}
