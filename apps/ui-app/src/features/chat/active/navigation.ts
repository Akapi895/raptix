// Moving between conversations: the generation that tells stale work apart from the current one, the load in
// progress, and the "#chat?conversation=" address that lets a reload reconnect the visible conversation.

const CHAT_HASH = '#chat';

/** The address that names `conversationId`, or null when the address already names it or the chat page is not open. */
export function chatHashForConversation(hash: string, conversationId: string): string | null {
  const id = String(conversationId || '').trim();
  if (!id || hash.split('?')[0] !== CHAT_HASH) return null;
  const target = `${CHAT_HASH}?conversation=${encodeURIComponent(id)}`;
  return hash !== target ? target : null;
}

/** The address of the chat page without a conversation, or null when it has none to drop. */
export function chatHashWithoutConversation(hash: string): string | null {
  if (hash.split('?')[0] !== CHAT_HASH || hash === CHAT_HASH) return null;
  return CHAT_HASH;
}

export interface NavigationDependencies {
  /** The conversation on screen, trimmed; empty for a new chat. */
  visibleConversation(): string;
  cancelScheduledFromHash(): void;
  /** Detaches the live stream from the conversation being left (see live-stream.ts). */
  detachLiveStream(nextConversationId: string, force: boolean): void;
}

export interface ConversationNavigation {
  /** The generation of the visible conversation. Work that started under an older one is stale. */
  seq(): number;
  /** Starts a new generation when the visible conversation changes (or always, when forced). */
  mark(nextConversationId: string, force?: boolean): number;
  loadSeq(): number;
  nextLoadSeq(): number;
  isLoadPending(conversationId: string): boolean;
  pendingLoadId(): string;
  /** Registers a conversation load that is starting, and returns the controller that cancels it. */
  beginLoad(conversationId: string): AbortController;
  /** Forgets the load once it has finished. */
  finishLoad(conversationId: string): void;
  /** Drops the controller of a load that finished, when it is still the current one. */
  releaseController(controller: AbortController): void;
  /** Aborts the load in progress; returns whether there was one. */
  cancelPendingLoad(): boolean;
  /** Leaving the chat page: nothing started earlier may take the page back. */
  abandonForPageNavigation(): void;
}

export function createConversationNavigation(deps: NavigationDependencies): ConversationNavigation {
  let seq = 0;
  let loadSeq = 0;
  let pendingId = '';
  let loadController: AbortController | null = null;

  function cancelPendingLoad(): boolean {
    if (!loadController) return false;
    if (!loadController.signal.aborted) loadController.abort();
    loadController = null;
    return true;
  }

  function mark(nextConversationId: string, force = false): number {
    const next = String(nextConversationId || '').trim();
    if (force || next !== deps.visibleConversation()) seq++;
    return seq;
  }

  return {
    seq: () => seq,
    mark,
    loadSeq: () => loadSeq,
    nextLoadSeq: () => ++loadSeq,
    isLoadPending(conversationId) {
      const id = String(conversationId || '').trim();
      return !!id && pendingId === id;
    },
    pendingLoadId: () => pendingId,
    beginLoad(conversationId) {
      pendingId = String(conversationId || '').trim();
      loadController = new AbortController();
      return loadController;
    },
    finishLoad(conversationId) {
      if (pendingId === String(conversationId || '').trim()) pendingId = '';
    },
    releaseController(controller) {
      if (controller === loadController) loadController = null;
    },
    cancelPendingLoad,
    abandonForPageNavigation() {
      mark('', true);
      deps.cancelScheduledFromHash();
      cancelPendingLoad();
      deps.detachLiveStream('', true);
    },
  };
}
