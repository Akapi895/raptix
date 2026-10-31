// Deleting a turn of the open conversation, and deleting a whole conversation. Both confirm first, then refresh what is on screen.

export interface DeletePorts {
  request(path: string, init?: RequestInit): Promise<Response>;
  currentConversationId(): string;
  confirm(message: string): boolean;
  alert(message: string): void;
  translate(key: string, fallback: string): string;
  invalidateCache(conversationId: string): void;
  reloadConversation(conversationId: string): Promise<unknown> | void;
  loadConversations(): void;
  /** The open conversation was the one deleted: the message area and the header are cleared. */
  clearOpenConversation(): void;
  announceDeleted(conversationId: string): void;
  forgetBatch(conversationId: string): void;
  logError(message: string, error: unknown): void;
}

function errorText(error: unknown): string {
  return error && (error as Error).message ? (error as Error).message : String(error);
}

export function createConversationDeleter(ports: DeletePorts) {
  /** Deletes the whole turn that holds the anchor message: from its user message to the next user message. */
  async function deleteTurn(anchorBackendMessageId: string | null | undefined): Promise<void> {
    const conversationId = ports.currentConversationId();
    if (!conversationId || !anchorBackendMessageId) return;
    if (!ports.confirm(ports.translate('chat.deleteTurnConfirm', 'Delete this entire turn (user message and assistant reply)? This cannot be undone. The next reply will use only the remaining messages; saved context snapshots will be cleared.'))) return;
    try {
      const response = await ports.request(`/api/conversations/${conversationId}/delete-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: anchorBackendMessageId }),
      });
      let data: { error?: string; message?: string } = {};
      try {
        data = await response.json();
      } catch { /* the body is optional on failure */ }
      if (!response.ok) throw new Error(data.error || data.message || 'delete failed');
      ports.invalidateCache(conversationId);
      await ports.reloadConversation(conversationId);
      ports.loadConversations();
    } catch (error) {
      ports.logError('delete turn failed:', error);
      ports.alert(ports.translate('chat.deleteTurnFailed', 'Failed to delete turn') + ': ' + errorText(error));
    }
  }

  /** Deletes a conversation. The removal is shown in the sidebar at once; the list is read again after it. */
  async function deleteConversation(conversationId: string, skipConfirm = false): Promise<void> {
    if (!skipConfirm && !ports.confirm('Delete this conversation? Messages cannot be recovered, but recorded vulnerabilities remain in the vulnerability library.')) return;
    try {
      const response = await ports.request(`/api/conversations/${conversationId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Delete failed');
      }
      if (conversationId === ports.currentConversationId()) ports.clearOpenConversation();
      ports.invalidateCache(conversationId);
      // The sidebars are updated before the network refresh: the project folders keep their own cache.
      ports.announceDeleted(conversationId);
      ports.loadConversations();
      ports.forgetBatch(conversationId);
    } catch (error) {
      ports.logError('Failed to delete conversation:', error);
      ports.alert('Failed to delete the conversation: ' + errorText(error));
    }
  }

  return { deleteTurn, deleteConversation };
}

/** Adds the "delete this turn" button to the footer of an assistant message that has a backend id. */
export function attachDeleteTurnButton(doc: Document, messageEl: HTMLElement | null, title: string, onDelete: (backendMessageId: string) => void): void {
  if (!messageEl || !messageEl.dataset.backendMessageId) return;
  if (messageEl.querySelector('.message-delete-turn-btn')) return;
  const content = messageEl.querySelector<HTMLElement>('.message-content');
  if (!content) return;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'message-delete-turn-btn';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  button.onclick = event => {
    event.stopPropagation();
    event.preventDefault();
    onDelete(messageEl.dataset.backendMessageId || '');
  };
  const timeDiv = content.querySelector<HTMLElement>('.message-time');
  let footer = content.querySelector<HTMLElement>('.message-meta-footer');
  if (!footer && timeDiv && timeDiv.parentNode === content) {
    footer = doc.createElement('div');
    footer.className = 'message-meta-footer';
    timeDiv.parentNode.insertBefore(footer, timeDiv);
    footer.appendChild(timeDiv);
  }
  (footer ?? content).appendChild(button);
}
