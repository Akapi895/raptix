import type { ChatRequest, StreamEvent } from '../../api/types/chat';
import type { Conversation, Message } from '../../api/types/conversation';

export type Translate = (key: string, options?: Record<string, unknown>) => string;
export type ProcessDetail = Record<string, unknown>;
export interface LiveChatStream {
  active: boolean; conversationId: string | null; progressId: string;
  abortController: AbortController; detached: boolean; navigationSeq: number;
}
/** Monitor owns progress rendering, task replay, and the finalization UI contract. */
export interface ChatMonitorPort {
  refreshTasks(): Promise<void>;
  isRunning(conversationId: string): boolean;
  started(conversationId: string): void;
  addProgress(): string;
  registerProgress(progressId: string, conversationId: string | null): void;
  bindProgress(progressId: string, conversationId: string): void;
  handleEvent(event: StreamEvent, progressElement: HTMLElement | null, progressId: string,
    getAssistant: () => string | null, setAssistant: (id: string) => void,
    getExecutions: () => string[], setExecutions: (ids: string[]) => void,
    context: { conversationId: string | null }): void;
  attachReplay(conversationId: string): Promise<boolean>;
  cancelReplay(nextConversationId: string): void;
  skipReplay(conversationId: string): boolean;
  toggleDetails(progressId: string | null, messageId: string): void;
  loadDetails(messageId: string): Promise<void>;
  renderDetail(timeline: HTMLElement, detail: ProcessDetail): void;
  stop(conversationId: string, progressId?: string): void;
}
export interface ChatHitlPort {
  sync(conversationId: string): Promise<void>;
  restore(conversationId: string): Promise<void>;
  clear(): void;
  readConfig(conversationId: string): ChatRequest['hitl'];
  saveConfig(conversationId: string, config: NonNullable<ChatRequest['hitl']>): Promise<void>;
}
export interface ChatDependencies {
  translate: Translate;
  locale(): string;
  monitor: ChatMonitorPort;
  hitl: ChatHitlPort;
  getActiveProjectId(): string;
  setActiveProjectId(id: string): void;
  getProjectName(id: string): string;
  refreshProjects(): Promise<void>;
  selectProjectConversation(id: string): void;
  getRole(): string;
  setRole(role: string): void;
  navigate(page: string): void;
  syncAddress(conversationId: string): void;
  cancelScheduledNavigation(): void;
  finishRestore(conversationId: string): void;
  conversationChanged(conversationId: string, projectId: string): void;
  conversationDeleted(conversationId: string): void;
  conversationUpdated(conversationId: string, patch: { title?: string; pinned?: boolean }): void;
  liveStreamChanged(stream: LiveChatStream | null): void;
  takeFinalizationPolicy(): ChatRequest['finalization'];
  openModal(id: string): void;
  closeModal(id: string): void;
  notify(message: string, type?: string): void;
  confirm(message: string): boolean;
  copy(text: string): Promise<void>;
  download(blob: Blob, name: string): void;
  upload(form: FormData, progress: (percent: number) => void): Promise<unknown>;
}
export interface AddMessageOptions {
  scroll?: 'none' | 'force' | 'follow'; deferMcpButtons?: boolean;
  hideAssistantPlaceholder?: boolean; systemReadyMessage?: boolean;
}
export interface ChatPresentation {
  clear(): void;
  welcome(): void;
  addMessage(role: string, content: string, executionIds?: string[] | null, progressId?: string | null,
    createdAt?: string | number | Date | null, options?: AddMessageOptions | null): string;
  restore(conversation: Conversation, isCurrent: () => boolean): Promise<void>;
  removeMessage(id: string): void;
  primaryAction(): void;
  input(value?: string): string;
  sent(): void;
  activeConversation(): void;
}
export interface ChatScroll {
  captureScrollPinState(): boolean;
  isChatMessagesPinnedToBottom(): boolean;
  scrollChatMessagesToBottomIfPinned(wasPinned?: boolean): void;
  forceScrollToBottom(smooth?: boolean): void;
  scheduleScroll(wasPinnedBeforeDomUpdate?: boolean): void;
  settleConversationRestoreToBottom(frames?: number): void;
  settleToBottomIfFollowing(frames?: number): void;
  onUserSendMessage(): void;
  onStreamEnd(): void;
  onTaskEventStreamBegin(conversationId: string, assistantDomId?: string | null, progressId?: string | null): void;
  onTaskEventStreamEnd(): void;
  markProgressStreaming(active: boolean, progressId?: string): void;
  markProcessDetailsStreaming(active: boolean, assistantDomId?: string | null): void;
  applyMessageScroll(options?: AddMessageOptions | null): void;
  scrollElementIntoViewIfFollowing(element: Element, options?: ScrollIntoViewOptions): void;
  refreshTurnRail(): void;
  destroy(): void;
}
export interface ToolSummary { executionId: string; toolCallId: string; toolName: string; status: string; processDetailId?: string }
export interface TurnTiming { startedAt?: string | number | Date | null; completedAt?: string | number | Date | null; durationMs?: number; status?: string }
export interface TurnUsage { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number; reasoningTokens?: number }
export type ChatMessage = Message;
