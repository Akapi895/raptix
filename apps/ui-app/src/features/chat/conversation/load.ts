// Opening a conversation: its navigation generation, the messages rendered in batches, and the reads that follow the messages.

import { BACKEND_DEFAULT_ROLE, BACKEND_PROCESSING_PLACEHOLDER } from '@/platform/backend-legacy-strings';

export interface ProcessDetailRecord {
  eventType?: string;
  message?: string;
}

export interface MessageRecord {
  id?: string | number;
  role: string;
  content?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
  reasoningContent?: unknown;
  processDetails?: ProcessDetailRecord[] | null;
  mcpExecutionIds?: string[] | null;
}

export interface ConversationRecord {
  error?: string;
  projectId?: string;
  project_id?: string;
  roleName?: string;
  role_name?: string;
  messages?: MessageRecord[] | null;
  retest?: { pending_prompt?: string } | null;
  [key: string]: unknown;
}

export interface TurnTerminal {
  status: string;
  completedAt?: unknown;
  detail: { message?: string };
}

export interface LoadNavigation {
  nextLoadSeq(): number;
  loadSeq(): number;
  beginLoad(conversationId: string): AbortController;
  finishLoad(conversationId: string): void;
  releaseController(controller: AbortController): void;
}

export interface LoadPorts {
  nav: LoadNavigation;
  // Navigation and the page's conversation id, which is written in both places the page reads from.
  markNavigation(conversationId: string): void;
  cancelScheduledHash(): void;
  syncHash(conversationId: string): void;
  clearHash(): void;
  cancelPendingLoad(): void;
  detachLiveStream(conversationId: string): void;
  cancelRunningTaskReplay(conversationId: string): void;
  clearHitlDock(): void;
  currentConversationId(): string;
  setCurrentConversationId(conversationId: string | null): void;
  selectProjectItem(conversationId: string | null): void;
  // Cache, network and the project and role of the conversation.
  cachedConversation(conversationId: string): ConversationRecord | null;
  putCachedConversation(conversationId: string, conversation: ConversationRecord): void;
  request(path: string, init?: RequestInit): Promise<Response>;
  setLoadedProjectId(projectId: string): void;
  setRole(roleName: string): void;
  dispatchChanged(conversationId: string): void;
  updateActions(): void;
  refreshProjectSelector(): void;
  // HITL and the streams that follow.
  refreshHitlConfig(): void;
  syncHitlConfig(conversationId: string): Promise<unknown> | undefined;
  beginHitlConfigSync(conversationId: string, promise: Promise<unknown>): void;
  restoreHitlInline(conversationId: string): Promise<unknown> | undefined;
  shouldSkipReplay(conversationId: string): boolean;
  attachRunning(conversationId: string): Promise<unknown> | undefined;
  prefetchLastDetails(): Promise<unknown> | undefined;
  hydrateTokenUsage(conversationId: string, seq: number, signal: AbortSignal): Promise<unknown> | undefined;
  finishRestore(conversationId: string): void;
  // Sidebar and the attack chain modal.
  updateActiveConversation(): void;
  closeAttackChainIfNot(conversationId: string): void;
  addAttackChainButton(conversationId: string | null): void;
  // The message area.
  messages(): HTMLElement | null;
  clearComposer(): void;
  fitComposer(input: HTMLTextAreaElement): void;
  renderWelcome(): void;
  forceScrollToBottom(): void;
  settleRestoreToBottom(margin: number): void;
  addMessage(role: string, content: unknown, mcpIds: string[], time: string | null, options: MessageOptions | null): string;
  messageElement(messageId: string): HTMLElement | null;
  attachDeleteTurnButton(element: HTMLElement): void;
  setTurnTiming(element: HTMLElement, timing: TurnTiming): void;
  setReasoning(element: HTMLElement, reasoning: unknown): void;
  renderDetails(messageId: string, details: ProcessDetailRecord[] | null): void;
  collapseDetails(messageId: string): void;
  // Pure helpers of the turn and of the messages.
  terminalState(processDetails: ProcessDetailRecord[] | null | undefined): TurnTerminal | null;
  turnTimestamp(value: unknown): number;
  isInterruptContinueMessage(content: unknown): boolean;
  // Reporting.
  toast(message: string, type: 'error'): void;
  logWarn(message: string, error: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface MessageOptions {
  deferMcpButtons: boolean;
  hideAssistantPlaceholder: boolean;
}

export interface TurnTiming {
  startedAt: unknown;
  completedAt: unknown;
  durationMs?: number;
  status: string;
}

const FIRST_BATCH = 20;
const BATCH_SIZE = 10;
const RECENT_USER_MESSAGE_MS = 30000;
const PLACEHOLDER_TEXTS = [BACKEND_PROCESSING_PLACEHOLDER, 'Processing...'];

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_TEXTS.includes(text);
}

/** The creation of the messages and the reads that follow them. Returns a loader for one conversation at a time. */
export function createConversationLoader(ports: LoadPorts) {
  /** One message on the screen: its bubble, its time, its reasoning, and the timing and details of an assistant turn. */
  function renderMessage(msg: MessageRecord): void {
    if (msg.role === 'user' && ports.isInterruptContinueMessage(msg.content)) return;
    const assistantContent = String(msg.content != null ? msg.content : '').trim();
    const terminal = msg.role === 'assistant' ? ports.terminalState(msg.processDetails) : null;
    let displayContent = msg.content;
    if (msg.role === 'assistant' && isPlaceholder(assistantContent) && terminal) {
      displayContent = terminal.detail.message || msg.content;
    }
    // The assistant's time is the time the task finished when the server has it: the placeholder's start time would mislead.
    const time = msg.role === 'assistant' && msg.updatedAt ? msg.updatedAt : (msg.createdAt ?? null);
    const mcpIds = Array.isArray(msg.mcpExecutionIds) ? msg.mcpExecutionIds : [];
    const placeholder = msg.role === 'assistant' && isPlaceholder(assistantContent);
    const options = msg.role === 'assistant' && (mcpIds.length > 0 || placeholder)
      ? { deferMcpButtons: mcpIds.length > 0, hideAssistantPlaceholder: placeholder }
      : null;
    const messageId = ports.addMessage(msg.role, displayContent, mcpIds, time, options);
    const element = ports.messageElement(messageId);
    if (element && msg.id) {
      element.dataset.backendMessageId = String(msg.id);
      ports.attachDeleteTurnButton(element);
    }
    if (msg.role !== 'assistant') return;
    if (element) {
      const startedAt = msg.createdAt ?? null;
      const completedAt = terminal && terminal.completedAt ? terminal.completedAt : (msg.updatedAt ? msg.updatedAt : startedAt);
      const startedMs = ports.turnTimestamp(startedAt);
      const completedMs = ports.turnTimestamp(completedAt);
      const running = placeholder && !terminal;
      ports.setTurnTiming(element, {
        startedAt,
        completedAt: running ? null : completedAt,
        durationMs: !running && Number.isFinite(startedMs) && Number.isFinite(completedMs) ? Math.max(0, completedMs - startedMs) : undefined,
        status: terminal ? terminal.status : (running ? 'running' : 'completed'),
      });
    }
    if (element && msg.reasoningContent) ports.setReasoning(element, msg.reasoningContent);
    const hasDetails = Object.prototype.hasOwnProperty.call(msg, 'processDetails');
    ports.renderDetails(messageId, hasDetails ? (msg.processDetails || []) : null);
    if (msg.processDetails && msg.processDetails.some(d => d.eventType === 'error' || d.eventType === 'cancelled')) {
      ports.collapseDetails(messageId);
    }
  }

  /** The messages after the first batch are drawn a batch per frame, so that a long conversation does not hold the page. */
  function renderMessages(messages: MessageRecord[], conversationId: string, seq: number): Promise<void> {
    const first = messages.slice(0, FIRST_BATCH);
    const rest = messages.slice(FIRST_BATCH);
    first.forEach(renderMessage);
    if (rest.length === 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      let offset = 0;
      const next = () => {
        if (seq !== ports.nav.loadSeq() || ports.currentConversationId() !== conversationId) {
          resolve();
          return;
        }
        rest.slice(offset, offset + BATCH_SIZE).forEach(renderMessage);
        offset += BATCH_SIZE;
        if (offset < rest.length) {
          requestAnimationFrame(next);
          return;
        }
        ports.forceScrollToBottom();
        resolve();
      };
      requestAnimationFrame(next);
    });
  }

  /** Whether the last message was sent in the last half minute: its draft is then already sent and must not return. */
  function hasRecentUserMessage(messages: MessageRecord[] | null | undefined): boolean {
    if (!messages || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' || !last.createdAt) return false;
    return Date.now() - new Date(last.createdAt).getTime() < RECENT_USER_MESSAGE_MS;
  }

  /** Opens a conversation. A newer call takes over: the reads and renders of the older one stop where they are. */
  async function loadConversation(rawConversationId: unknown): Promise<void> {
    const conversationId = String(rawConversationId || '').trim();
    if (!conversationId) return;
    // The conversation stays addressable across a page refresh: the hash is written before anything waits.
    ports.markNavigation(conversationId);
    ports.cancelScheduledHash();
    ports.syncHash(conversationId);
    const seq = ports.nav.nextLoadSeq();
    const previousConversationId = ports.currentConversationId();
    ports.cancelPendingLoad();
    ports.detachLiveStream(conversationId);
    // The click is the new visible conversation. It is committed before any network wait, so that the task refresh does not keep the old one visible.
    ports.setCurrentConversationId(conversationId);
    const controller = ports.nav.beginLoad(conversationId);
    ports.selectProjectItem(conversationId);
    ports.cancelRunningTaskReplay(conversationId);
    ports.clearHitlDock();

    const restorePrevious = () => {
      ports.setCurrentConversationId(previousConversationId || null);
      if (previousConversationId) ports.syncHash(previousConversationId);
      else ports.clearHash();
    };

    try {
      const cached = ports.cachedConversation(conversationId);
      let conversation: ConversationRecord;
      let response: Response | null = null;
      try {
        response = await ports.request(`/api/conversations/${conversationId}?include_process_details=0`, { signal: controller.signal });
        conversation = await response.json();
      } catch (fetchError) {
        if (fetchError && (fetchError as Error).name === 'AbortError') return;
        if (!cached) throw fetchError;
        ports.logWarn('Failed to load the latest conversation; using the local cache:', fetchError);
        conversation = cached;
      }
      if (seq !== ports.nav.loadSeq()) return;
      if (response && !response.ok) {
        if (seq === ports.nav.loadSeq()) restorePrevious();
        ports.toast('Failed to load the conversation: ' + (conversation.error || 'Unknown error'), 'error');
        return;
      }
      if (response && response.ok) ports.putCachedConversation(conversationId, conversation);
      if (seq !== ports.nav.loadSeq()) return;

      ports.setCurrentConversationId(conversationId);
      ports.setLoadedProjectId(conversation.projectId || conversation.project_id || '');
      ports.setRole(conversation.roleName || conversation.role_name || BACKEND_DEFAULT_ROLE);
      ports.dispatchChanged(conversationId);
      ports.updateActions();
      ports.refreshProjectSelector();
      ports.refreshHitlConfig();
      const hitlSync = ports.syncHitlConfig(conversationId);
      const hitlSyncPromise: Promise<unknown> = hitlSync
        ? Promise.resolve(hitlSync).then(() => {
          if (seq === ports.nav.loadSeq() && ports.currentConversationId() === conversationId) ports.refreshHitlConfig();
        }).catch(() => {})
        : Promise.resolve();
      ports.beginHitlConfigSync(conversationId, hitlSyncPromise);
      await hitlSyncPromise;
      if (seq !== ports.nav.loadSeq() || ports.currentConversationId() !== conversationId) return;
      ports.updateActiveConversation();
      ports.closeAttackChainIfNot(conversationId);

      const area = ports.messages();
      if (seq !== ports.nav.loadSeq() || !area) return;
      area.innerHTML = '';
      if (hasRecentUserMessage(conversation.messages)) {
        ports.clearComposer();
      }

      if (conversation.messages && conversation.messages.length > 0) {
        const pending = renderMessages(conversation.messages, conversationId, seq);
        ports.forceScrollToBottom();
        ports.addAttackChainButton(conversationId);
        await pending;
        if (seq !== ports.nav.loadSeq()) return;
        Promise.resolve(ports.hydrateTokenUsage(conversationId, seq, controller.signal)).catch((e: unknown) => {
          if (!e || (e as Error).name !== 'AbortError') ports.logWarn('hydrateConversationTokenUsage failed', e);
        });
        if (ports.currentConversationId() === conversationId) await ports.restoreHitlInline(conversationId);
        ports.settleRestoreToBottom(30);
      } else {
        ports.renderWelcome();
        ports.forceScrollToBottom();
        ports.addAttackChainButton(conversationId);
        if (seq !== ports.nav.loadSeq()) return;
        if (ports.currentConversationId() === conversationId) await ports.restoreHitlInline(conversationId);
      }

      // A branch may have been created while the navigation interrupted its automatic send: its own prompt is restored.
      const pendingPrompt = conversation.retest && conversation.retest.pending_prompt;
      const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (seq === ports.nav.loadSeq() && ports.currentConversationId() === conversationId && pendingPrompt && input &&
        (previousConversationId !== conversationId || !input.value.trim())) {
        input.value = pendingPrompt;
        ports.fitComposer(input);
      }

      // After a refresh the main stream is gone. A conversation that still runs on the server gets its task events attached again.
      if (seq === ports.nav.loadSeq() && ports.currentConversationId() === conversationId) {
        if (!ports.shouldSkipReplay(conversationId)) {
          Promise.resolve()
            .then(() => ports.attachRunning(conversationId))
            .catch((e: unknown) => ports.logWarn('attachRunningTaskEventStream on loadConversation failed', e));
        } else {
          // Robot and other non-web sources: the details of the last assistant message are read when the task is not registered.
          Promise.resolve(ports.prefetchLastDetails()).catch((e: unknown) => ports.logWarn('prefetchLastAssistantProcessDetails failed', e));
        }
      }
    } catch (error) {
      if (error && (error as Error).name === 'AbortError') return;
      if (seq === ports.nav.loadSeq()) {
        restorePrevious();
        ports.selectProjectItem(previousConversationId || null);
      }
      ports.logError('Failed to load the conversation:', error);
      ports.toast('Failed to load the conversation: ' + (error && (error as Error).message ? (error as Error).message : String(error)), 'error');
    } finally {
      if (seq === ports.nav.loadSeq()) ports.finishRestore(conversationId);
      ports.nav.releaseController(controller);
      if (seq === ports.nav.loadSeq()) ports.nav.finishLoad(conversationId);
    }
  }

  return { loadConversation };
}
