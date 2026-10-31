// Sending a message: the checks before the request (a task already running, uploads still in progress), the request
// body, reading the answer stream, and turning a failure into a line in the transcript. Everything the page owns is
// reached through the ports, so the flow reads the same whether the page is classic or migrated.

import { normalizeHitlMode, normalizeHitlReviewer, normalizeHitlTimeout, splitTools, DEFAULT_HITL_TIMEOUT_SECONDS, HITL_MODE_OFF } from '../hitl-model';
import { ownsLiveStream, shouldIgnoreLiveStreamEvent } from '../live-stream';
import type { LiveChatStream } from '../types';
import { CHAT_FILE_DEFAULT_PROMPT, withAttachmentNames, type AttachmentsController, type ChatAttachment, type Translate } from './attachments';

export interface HitlFormValues {
  mode: unknown;
  reviewer: unknown;
  sensitiveTools: unknown;
  timeoutSeconds: unknown;
}

export interface ChatRequestParts {
  message: string;
  conversationId: string | null;
  role: string;
  finalization?: unknown;
  activeProjectId: string;
  aiChannelId: string;
  hitl: HitlFormValues;
  attachments: readonly ChatAttachment[];
  reasoning?: unknown;
}

export interface ChatRequestBody {
  message: string;
  conversationId: string | null;
  role: string;
  finalization?: unknown;
  projectId?: string;
  aiChannelId?: string;
  hitl?: { enabled: true; mode: string; reviewer: string; sensitiveTools: string[]; timeoutSeconds: number };
  attachments?: { fileName: string; mimeType: string; serverPath: string | null }[];
  reasoning?: unknown;
}

/** The body the chat API receives. The project is only sent for a new chat, the HITL block only when it is on. */
export function buildChatRequestBody(parts: ChatRequestParts): ChatRequestBody {
  const body: ChatRequestBody = { message: parts.message, conversationId: parts.conversationId, role: parts.role };
  if (parts.finalization) body.finalization = parts.finalization;
  if (!parts.conversationId && parts.activeProjectId) body.projectId = parts.activeProjectId;
  if (parts.aiChannelId) body.aiChannelId = parts.aiChannelId;
  const mode = normalizeHitlMode(parts.hitl.mode);
  if (mode !== HITL_MODE_OFF) {
    body.hitl = {
      enabled: true,
      mode,
      reviewer: normalizeHitlReviewer(parts.hitl.reviewer),
      sensitiveTools: splitTools(String(parts.hitl.sensitiveTools || '')),
      timeoutSeconds: normalizeHitlTimeout(parts.hitl.timeoutSeconds, DEFAULT_HITL_TIMEOUT_SECONDS),
    };
  }
  if (parts.attachments.length) {
    body.attachments = parts.attachments.map(item => ({ fileName: item.fileName, mimeType: item.mimeType || '', serverPath: item.serverPath }));
  }
  if (parts.reasoning) body.reasoning = parts.reasoning;
  return body;
}

const NETWORK_ERROR = /network|fetch|Failed to fetch|aborted|AbortError|load failed|NetworkError/i;

/** Whether a failed request reads like a dropped connection rather than an error the server reported. */
export function isNetworkFailure(message: string): boolean {
  return NETWORK_ERROR.test(message);
}

export function parseSseDataLine(line: string): { event: unknown } | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return { event: JSON.parse(line.slice(6)) };
  } catch (error) {
    console.error('Failed to parse event data:', error, line);
    return null;
  }
}

/** Reads the `data:` lines of a server-sent event stream, one event at a time, keeping a partial line for the next chunk. */
export async function readSseEvents(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void | Promise<void>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emit = async (lines: string[]) => {
    for (const line of lines) {
      const parsed = parseSseDataLine(line);
      if (parsed) await onEvent(parsed.event);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    await emit(lines);
  }
  // Flush the decoder so a multi-byte character split across the last chunks is not lost.
  buffer += decoder.decode();
  if (buffer.trim()) await emit(buffer.split('\n'));
}

export interface LiveStreamPort {
  get(): LiveChatStream | null;
  set(stream: LiveChatStream | null): void;
  clear(stream: LiveChatStream): boolean;
  navigationSeq(): number;
}

export interface ProgressPort {
  /** Adds the progress bubble for the request and returns its element id. */
  start(): string;
  register(progressId: string, conversationId: string | null): void;
  /** Ties a progress bubble to the conversation the server created for it. */
  bindConversation(progressId: string, conversationId: string): void;
  exists(progressId: string): boolean;
  element(progressId: string): HTMLElement | null;
}

export interface EventContext {
  progressElement: HTMLElement | null;
  progressId: string;
  getAssistantId(): string | null;
  setAssistantId(id: string): void;
  getExecutionIds(): string[];
  setExecutionIds(ids: string[]): void;
  conversationId: string | null;
}

export interface SendDependencies {
  input(): HTMLTextAreaElement | null;
  attachments: AttachmentsController;
  drafts: { cancelPending(): void; clear(): void };
  t: Translate;
  alert(text: string): void;
  toast(text: string, type: 'info' | 'error'): void;
  /** The conversation on screen (null for a new chat). */
  conversationId(): string | null;
  navigationSeq(): number;
  role(): string;
  activeProjectId(): string;
  aiChannelId(): string;
  hitlForm(): HitlFormValues;
  reasoning(): unknown;
  takeFinalizationPolicy(): unknown;
  streamEndpoint(signal: AbortSignal): Promise<string>;
  request(path: string, init: RequestInit): Promise<Response>;
  waitForHitlReady(conversationId: string): Promise<void>;
  loadActiveTasks(): Promise<void> | void;
  isTaskActive(): boolean;
  refreshPrimaryAction(): void;
  addUserMessage(text: string): void;
  addSystemMessage(text: string): void;
  removeMessage(id: string): void;
  invalidateLiteCache(conversationId: string): void;
  notifyTaskStarted(conversationId: string): void;
  live: LiveStreamPort;
  progress: ProgressPort;
  handleEvent(event: unknown, context: EventContext): void;
  canAttachReplay(): boolean;
  attachReplay(conversationId: string): Promise<boolean>;
  scroll: { onUserSendMessage(): void; onStreamEnd(): void; markProgressStreaming(progressId: string): void };
}

export interface SendOptions {
  onRequestAccepted?: () => void;
}

/** Sends the message in the input (or the attachments alone). Resolves once the answer has been read. */
export async function sendChatMessage(deps: SendDependencies, options: SendOptions = {}): Promise<void> {
  const input = deps.input();
  if (!input) return;
  let message = input.value.trim();
  const attachments = deps.attachments.list();
  const hasAttachments = attachments.length > 0;
  const requestConversationId = deps.conversationId();
  const requestNavigationSeq = deps.navigationSeq();
  if (!message && !hasAttachments) return;

  // A restored conversation shows its cached messages first, while its HITL config is still on its way. A send in
  // that window must not fall back to the default reviewer, so it waits for the config of this conversation.
  const hitlConversation = String(requestConversationId || '').trim();
  await deps.waitForHitlReady(hitlConversation);
  if (String(deps.conversationId() || '').trim() !== hitlConversation) return;

  // The same conversation may already run in another tab: check before the bubble is shown.
  if (deps.conversationId()) await deps.loadActiveTasks();
  if (deps.isTaskActive()) {
    deps.refreshPrimaryAction();
    deps.toast(deps.t('chat.taskAlreadyRunning', 'A task is already running in this conversation. Wait for it to finish or stop it first.'), 'info');
    return;
  }

  if (hasAttachments) {
    if (attachments.some(item => item.uploading)) {
      deps.attachments.setProgress(true, 0, deps.t('chat.waitingAttachmentsUpload', 'Waiting for attachments to finish uploading…'));
    }
    try {
      await Promise.all(attachments.map(item => item.uploadPromise ?? Promise.resolve()));
    } finally {
      deps.attachments.refreshProgress();
    }
    if (attachments.some(item => !item.serverPath)) {
      deps.alert(deps.t('chat.attachmentsUploadIncomplete', 'Some attachments failed to upload. Remove the failed items or pick files again before sending.'));
      return;
    }
  }

  if (hasAttachments && !message) message = CHAT_FILE_DEFAULT_PROMPT;

  // The checks above can wait. If the user has moved to another conversation meanwhile, nothing is sent here.
  if (requestNavigationSeq !== deps.navigationSeq()) return;

  deps.scroll.onUserSendMessage();
  deps.addUserMessage(withAttachmentNames(message, attachments));
  if (deps.conversationId()) deps.invalidateLiteCache(deps.conversationId() as string);

  deps.drafts.cancelPending();
  deps.drafts.clear();
  input.value = '';
  input.style.height = '40px';

  const body = buildChatRequestBody({
    message,
    conversationId: requestConversationId,
    role: deps.role(),
    finalization: deps.takeFinalizationPolicy(),
    activeProjectId: deps.activeProjectId(),
    aiChannelId: deps.aiChannelId(),
    hitl: deps.hitlForm(),
    attachments,
    reasoning: deps.reasoning(),
  });
  deps.attachments.clear();

  let streamConversationId: string | null = body.conversationId ? String(body.conversationId) : null;
  const progressId = deps.progress.start();
  deps.scroll.markProgressStreaming(progressId);
  deps.scroll.onUserSendMessage();
  deps.progress.register(progressId, streamConversationId);
  const progressElement = deps.progress.element(progressId);

  const abortController = new AbortController();
  const liveStream: LiveChatStream = {
    active: true,
    conversationId: streamConversationId,
    progressId,
    abortController,
    detached: false,
    navigationSeq: requestNavigationSeq,
  };
  deps.live.set(liveStream);
  if (streamConversationId) deps.notifyTaskStarted(streamConversationId);
  deps.refreshPrimaryAction();
  void deps.loadActiveTasks();

  let assistantId: string | null = null;
  let executionIds: string[] = [];
  const isVisibleForRequest = (): boolean => {
    if (!deps.progress.exists(progressId)) return false;
    if (!streamConversationId) return deps.conversationId() === body.conversationId;
    return deps.conversationId() === streamConversationId;
  };
  const clearLive = () => deps.live.clear(liveStream);

  try {
    const path = await deps.streamEndpoint(abortController.signal);
    abortController.signal.throwIfAborted();
    const response = await deps.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    if (!response.ok) throw new Error('Request failed: HTTP ' + response.status);
    options.onRequestAccepted?.();

    liveStream.conversationId = streamConversationId;
    try {
      if (!response.body) throw new Error('Chat stream has no response body');
      let sawDone = false;
      await readSseEvents(response.body, async event => {
        const data = event as { type?: unknown; data?: { conversationId?: unknown } } | null;
        if (data?.type === 'done') sawDone = true;
        const eventConversationId = data?.data?.conversationId ? String(data.data.conversationId) : '';
        let justBound = false;
        if (eventConversationId) {
          if (streamConversationId && streamConversationId !== eventConversationId) return;
          if (!streamConversationId) {
            streamConversationId = eventConversationId;
            liveStream.conversationId = eventConversationId;
            justBound = true;
          }
        }
        // A response that was already buffered when the user navigated away may still arrive. It can attach the
        // conversation to its task, but it must not take over the conversation on screen.
        if (shouldIgnoreLiveStreamEvent(liveStream, deps.live.get(), deps.navigationSeq())) {
          if (eventConversationId) deps.progress.bindConversation(progressId, eventConversationId);
          return;
        }
        if (!justBound && !isVisibleForRequest()) return;
        deps.handleEvent(event, {
          progressElement,
          progressId,
          getAssistantId: () => assistantId,
          setAssistantId: id => { assistantId = id; },
          getExecutionIds: () => executionIds,
          setExecutionIds: ids => { executionIds = ids; },
          conversationId: streamConversationId,
        });
      });

      if (!sawDone) {
        void deps.loadActiveTasks();
        const conversation = streamConversationId || body.conversationId || null;
        let attached = false;
        if (conversation && ownsLiveStream(liveStream, deps.live.get()) && !liveStream.detached && isVisibleForRequest() && deps.canAttachReplay()) {
          clearLive();
          attached = await deps.attachReplay(conversation).catch(() => false);
        }
        if (!attached && isVisibleForRequest()) {
          deps.addSystemMessage(deps.t('chat.streamEndedWithoutDone', 'The connection ended before a completion signal was received. The task may still be running on the server; check running tasks at the top or refresh this conversation.'));
        }
      }
    } finally {
      const clearedOwn = clearLive();
      if (clearedOwn && !liveStream.detached) deps.scroll.onStreamEnd();
    }

    deps.drafts.clear();
  } catch (error) {
    clearLive();
    if (liveStream.detached || !isVisibleForRequest()) {
      void deps.loadActiveTasks();
      return;
    }
    deps.removeMessage(progressId);
    const message = error && (error as Error).message != null ? String((error as Error).message) : String(error);
    if (isNetworkFailure(message)) {
      deps.addSystemMessage(deps.t('chat.streamNetworkErrorHint', `Connection lost (${message}). A long task may still be running on the server; check running tasks at the top or refresh this conversation later.`, { detail: message }));
    } else {
      deps.addSystemMessage('Error: ' + message);
    }
    void deps.loadActiveTasks();
  }
}
