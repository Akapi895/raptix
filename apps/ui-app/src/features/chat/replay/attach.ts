// Re-attaching to a running task after the page was away: the task's event stream is read again, its events are replayed into the
// last answer, and the answer is reconciled with the server when the stream could not tell the end. One attach runs at a time for
// a conversation; a newer attach to another conversation cancels the older one.

import { BACKEND_PROCESSING_PLACEHOLDER } from '@/platform/backend-legacy-strings';


export interface ReplayPorts {
  doc: Document;
  request(path: string, init?: RequestInit): Promise<Response>;
  currentConversationId(): string;
  findLastAssistant(): HTMLElement | null;
  assistantNeedsReconcile(el: HTMLElement | null): boolean;
  reconcileAfterReplay(conversationId: string, keepFollowing: boolean): Promise<boolean>;
  shouldSkipAttach(conversationId: string): boolean;
  loadPaginated(assistantId: string, backendId: string, options: { initialLatest: boolean; autoLoadAll: boolean; signal?: AbortSignal }): Promise<void>;
  restoreHitlInline(conversationId: string): Promise<void>;
  expandDetails(assistantId: string): void;
  beginReplay(progressId: string, assistantDomId: string, conversationId: string): void;
  replayProgressId(conversationId: string): string;
  clearReplay(): void;
  replayProgressIdOf(): string | null;
  replayConversationIdOf(): string | null;
  replayProgressOf(progressId: string): boolean;
  scrollBegin(conversationId: string, assistantId: string, progressId: string): void;
  scrollEnd(): void;
  startFollow(assistantId: string, options: { persistent: boolean }): void;
  stopFollow(assistantId: string): void;
  stopAllFollow(): void;
  settleToBottom(margin: number): void;
  forceScrollToBottom(): void;
  scrollIsRaptixAvailable(): boolean;
  capturePinned(): boolean;
  progress: { has(progressId: string): boolean; remove(progressId: string): void };
  loadConversations(): void;
  hasAssistantTurnTiming(): boolean;
  finalizeProgress(progressId: string, label: string): void;
  loadActiveTasks(): void;
  loadConversation(conversationId: string): Promise<unknown>;
  collapseAll(assistantId: string, progressId: string | null, options: { force: boolean }): void;
  onEvent(event: unknown, progressId: string, conversationId: string, assistantId: string, mcpIds: { get(): string[]; merge(ids: string[]): void }): void;
  readStreamLines(lines: string[], onEvent: (event: unknown) => void): Promise<void>;
  newDecoder(): { decode(input?: Uint8Array, options?: { stream: boolean }): string };
  logWarn(message: string, error: unknown): void;
  hasAssistantTurnTiming(): boolean;
  setAssistantTurnTiming(el: HTMLElement, timing: { startedAt: unknown; completedAt: unknown; status: string }): void;
  updateAssistantBubble(id: string, content: string): void;
  applyBackendIdToAssistant(domId: string, backendId: string): void;
  finalizeWithLabelDone(): string;
}

interface AttachState {
  conversationId: string | null;
  inFlightPromise: Promise<boolean> | null;
  token: object | null;
  abortController: AbortController | null;
}

/** The attach of the current conversation, if one is running. */
export function createTaskReplay(ports: ReplayPorts) {
  const attach: AttachState = { conversationId: null, inFlightPromise: null, token: null, abortController: null };

  /** Stops the attach of another conversation, so the page follows only the one it shows. */
  function cancelRunning(nextConversationId: string): boolean {
    const nextId = String(nextConversationId || '').trim();
    const activeId = String(attach.conversationId || '').trim();
    if (!activeId || activeId === nextId) return false;
    ports.stopAllFollow();
    if (attach.abortController) attach.abortController.abort();
    return true;
  }

  /** Attaches to a conversation's running task, and replays its events until the task ends. */
  function attachRunning(conversationId: string): Promise<boolean> | boolean {
    if (!conversationId) return false;
    if (attach.inFlightPromise && attach.conversationId === conversationId) return attach.inFlightPromise;
    if (ports.shouldSkipAttach(conversationId)) return false;
    cancelRunning(conversationId);
    const abortController = new AbortController();

    const token = {};
    const attachPromise: Promise<boolean> = (async () => {
      try {
        const check = await ports.request('/api/agent-loop/tasks', { signal: abortController.signal });
        if (!check.ok) return false;
        const j = await check.json().catch(() => ({})) as { tasks?: { conversationId?: string; status?: string }[] };
        const active = (j.tasks || []).some(t => t && t.conversationId === conversationId && (t.status === 'running' || t.status === 'cancelling'));
        if (!active) {
          const staleAssistant = ports.findLastAssistant();
          if (ports.assistantNeedsReconcile(staleAssistant)) await ports.reconcileAfterReplay(conversationId, true);
          return false;
        }

        const asEl = ports.findLastAssistant();
        if (!asEl || !asEl.id) return false;
        // The event request starts before the details load, so that the events during a long load are not missed.
        const url = '/api/agent-loop/task-events?conversationId=' + encodeURIComponent(conversationId);
        const eventStreamResponsePromise = ports.request(url, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: abortController.signal,
        }).then(response => ({ response, error: null as unknown }), error => ({ response: null as Response | null, error: error as unknown }));

        const backendId = asEl.dataset && asEl.dataset.backendMessageId;
        if (backendId) {
          // A running conversation can have far more than one page; the newest page is restored and the older ones load on scroll.
          await ports.loadPaginated(asEl.id, String(backendId), { initialLatest: true, autoLoadAll: false, signal: abortController.signal });
          if (abortController.signal.aborted) return false;
          // The history redraw rebuilds the timeline nodes, so the approval cards are mounted again.
          await ports.restoreHitlInline(conversationId);
        }
        ports.expandDetails(asEl.id);

        const progressId = ports.replayProgressId(conversationId);
        ports.beginReplay(progressId, asEl.id, conversationId);
        ports.scrollBegin(conversationId, asEl.id, progressId);
        // While the events are replayed, the iteration thinking follows its newest text; a reader who scrolls up stops it.
        ports.startFollow(asEl.id, { persistent: true });

        // The redraw of the newest page makes the details taller; once it is drawn, the page settles at the bottom if the reader stayed there.
        if (ports.capturePinned()) {
          ports.settleToBottom(12);
        }

        const eventStreamResult = await eventStreamResponsePromise;
        if (eventStreamResult.error) throw eventStreamResult.error;
        const response = eventStreamResult.response;
        if (!response || !response.ok) {
          ports.stopFollow(asEl.id);
          ports.clearReplay();
          if (ports.progress.has(progressId)) ports.progress.remove(progressId);
          ports.scrollEnd();
          await ports.reconcileAfterReplay(conversationId, true);
          return false;
        }

        const mcpState = (() => {
          let ids: string[] = [];
          return { get: () => ids, merge: (next: string[]) => { ids = mergeIds(ids, next); } };
        })();
        const assistantDomId = asEl.id;
        const reader = response.body!.getReader();
        const decoder = ports.newDecoder();
        let buffer = '';
        let replaySawDone = false;
        const dispatchTaskEvent = (eventData: unknown) => {
          const record = eventData as { type?: string; data?: { conversationId?: string } } | null;
          if (record && record.type === 'done') replaySawDone = true;
          const current = ports.currentConversationId();
          if (current && current !== conversationId) return;
          const eventConvId = record && record.data && record.data.conversationId ? String(record.data.conversationId) : '';
          if (eventConvId && eventConvId !== conversationId) return;
          ports.onEvent(eventData, progressId, conversationId, assistantDomId, mcpState);
        };
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          await ports.readStreamLines(lines, dispatchTaskEvent);
        }
        // The decoder's own bytes are flushed, so that a trailing partial character is not dropped.
        buffer += decoder.decode();
        if (buffer.trim()) await ports.readStreamLines(buffer.split('\n'), dispatchTaskEvent);

        if (ports.replayProgressOf(progressId)) ports.clearReplay();
        if (replaySawDone && ports.progress.has(progressId)) ports.finalizeProgress(progressId, ports.finalizeWithLabelDone());
        ports.scrollEnd();
        ports.stopFollow(asEl.id);
        ports.loadActiveTasks();
        if (!replaySawDone) {
          // The event bus closes when the task ends; a final frame lost in the race is reconciled with the database.
          await ports.reconcileAfterReplay(conversationId, ports.capturePinned());
        }
        if (replaySawDone && ports.currentConversationId() === conversationId) {
          const keepFollowingFinalRender = ports.capturePinned();
          await ports.loadConversation(conversationId);
          // The light message load puts the details back to lazy loading; the finished task reloads them from the database once.
          await refreshLastAssistantDetails(ports, conversationId);
          const finalAssistant = ports.findLastAssistant();
          if (finalAssistant && finalAssistant.id) ports.collapseAll(finalAssistant.id, progressId, { force: true });
          if (keepFollowingFinalRender) ports.settleToBottom(18);
        }
        return true;
      } catch (e) {
        if (!(e && (e as { name?: string }).name === 'AbortError')) ports.logWarn('attachRunningTaskEventStream', e);
        const ownsCurrentAttach = attach.token === token;
        if (ownsCurrentAttach) {
          const cur = ports.replayConversationIdOf();
          if (cur === conversationId) ports.clearReplay();
          ports.scrollEnd();
          const currentAssistant = ports.findLastAssistant();
          if (currentAssistant && currentAssistant.id) ports.stopFollow(currentAssistant.id);
          if (!abortController.signal.aborted) abortController.abort();
        }
        return false;
      } finally {
        if (attach.token === token) {
          attach.inFlightPromise = null;
          attach.token = null;
          attach.conversationId = null;
          attach.abortController = null;
        }
      }
    })();

    attach.conversationId = conversationId;
    attach.inFlightPromise = attachPromise;
    attach.token = token;
    attach.abortController = abortController;
    return attachPromise;
  }

  function isAttaching(conversationId: string): boolean {
    return attach.conversationId === conversationId && !!attach.inFlightPromise;
  }

  return { attachRunning, cancelRunning, isAttaching };
}

function mergeIds(prev: string[], next: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...prev, ...(next || [])]) {
    const s = value != null ? String(value).trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** The newest assistant answer's details are reloaded from the server, keeping them open when they were open. */
export async function refreshLastAssistantDetails(ports: ReplayPorts, conversationId: string): Promise<void> {
  if (!conversationId) return;
  const current = ports.currentConversationId();
  if (current && current !== conversationId) return;
  const msgEl = ports.findLastAssistant();
  if (!msgEl || !msgEl.dataset.backendMessageId || !msgEl.id) return;
  const backendId = String(msgEl.dataset.backendMessageId).trim();
  const clientId = msgEl.id;
  const wasExpanded = ports.doc.getElementById('process-details-' + clientId)?.querySelector('.progress-timeline')?.classList.contains('expanded') ?? false;
  try {
    // A restore walks every page: a single request without parameters would return only the first 50 records.
    await ports.loadPaginated(clientId, backendId, { initialLatest: false, autoLoadAll: true });
    if (wasExpanded) ports.expandDetails(clientId);
  } catch (e) {
    ports.logWarn('refreshLastAssistantProcessDetails', e);
  }
}

/** An answer still shows its placeholder, so the task is reconciled with the database when its stream could not tell the end. */
export function assistantMessageNeedsReconcile(assistantEl: HTMLElement | null): boolean {
  if (!assistantEl) return false;
  if (assistantEl.classList.contains('assistant-placeholder-content')) return true;
  const bubble = assistantEl.querySelector<HTMLElement>('.message-bubble');
  const text = bubble ? String(bubble.textContent || '').trim() : '';
  return !!(bubble && bubble.hidden) || text === BACKEND_PROCESSING_PLACEHOLDER || text === 'Processing...';
}

/**
 * The stream of a task can end before its connection is set: the task list still shows it as running. The last answer is then taken
 * from the database, its details are reloaded, and the page settles at the bottom if the reader was there.
 */
export async function reconcileAfterTaskReplay(ports: ReplayPorts, conversationId: string, keepFollowing: boolean): Promise<boolean> {
  if (!conversationId) return false;
  if (String(ports.currentConversationId() || '') !== String(conversationId)) return false;
  const response = await ports.request('/api/conversations/' + encodeURIComponent(String(conversationId)) + '?include_process_details=0');
  if (!response.ok) return false;
  const conversation = await response.json().catch(() => ({})) as { messages?: { id?: string; role?: string; content?: string; createdAt?: string; updatedAt?: string }[] };
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  let finalMessage: { id?: string; role?: string; content?: string; createdAt?: string; updatedAt?: string } | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === 'assistant') {
      finalMessage = message;
      break;
    }
  }
  const assistantEl = ports.findLastAssistant();
  if (!finalMessage || !assistantEl || !assistantEl.id) return false;

  ports.updateAssistantBubble(assistantEl.id, finalMessage.content || '');
  if (finalMessage.id) ports.applyBackendIdToAssistant(assistantEl.id, finalMessage.id);
  if (ports.hasAssistantTurnTiming()) {
    const startedAt = finalMessage.createdAt || null;
    const completedAt = finalMessage.updatedAt || startedAt;
    ports.setAssistantTurnTiming(assistantEl, { startedAt, completedAt, status: 'completed' });
  }
  if (finalMessage.id) {
    await ports.loadPaginated(assistantEl.id, String(finalMessage.id), { initialLatest: true, autoLoadAll: false });
  } else {
    await refreshLastAssistantDetails(ports, conversationId);
  }
  ports.collapseAll(assistantEl.id, null, { force: true });
  if (keepFollowing) ports.settleToBottom(24);
  ports.loadConversations();
  return true;
}
