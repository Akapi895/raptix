import type { ProjectsDependencies } from '@/features/projects';
import type { AssetsDependencies } from '@/features/assets';
import type { HitlDependencies } from '@/features/hitl';
import type { SettingsDependencies } from '@/features/settings';
import type { WebshellDependencies } from '@/features/webshell';

/** Lazy callbacks into chat. These are capabilities, never a chat/global state bag. */
export interface DomainChatPorts {
  initializeChatUI(): void;
  refreshChatConfig(): Promise<unknown>;
  loadConversations(query?: string): unknown;
  loadActiveTasks(showErrors?: boolean): unknown;
  loadConversation: ProjectsDependencies['loadConversation'];
  startNewConversation(options?: { projectId: string }): void | Promise<void>;
  currentConversationId(): string;
  abandonConversation(): void;
  conversationsSearchQuery(): string;
  setConversationProjectFilter(id: string): void;
  refreshConversationProjectFilter(): void;
  refreshAllProjectFilterSelects(): void | Promise<void>;
  getConversationProjectId(): string;
  setConversationProjectId(id: string): void;
  onConversationProjectBindingChanged(id: string): void;
  refreshChatWelcomeEmptyState(): void;
  openConversationContextMenu: ProjectsDependencies['openConversationContextMenu'];
  formatProjectName: ProjectsDependencies['formatProjectName'];
  applyProjectName: ProjectsDependencies['applyProjectName'];
  closeChatReasoningPanel(): void;
  roleChanged(): void;
  sendMessage: AssetsDependencies['sendMessage'];
  requireExecutionEvidence(): void;
  refreshChatProjectFoldersAfterAction(): unknown;
  showMCPDetail(id: string): unknown;
  cancelMCPToolExecution(id: string): unknown;
  closeMCPDetail(): void;
  refreshProgressAndTimelineI18n(): void;
  initChatFilesPage(): unknown;
  populateChatChannels: SettingsDependencies['populateChatChannels'];
  refreshMentionTools(): unknown;
  reasoning: WebshellDependencies['reasoning'];
  hitl: Pick<HitlDependencies,
    'getConversationConfig' | 'saveConversationConfigLocally' | 'applyConfigToUI' |
    'readConfigFromForm' | 'updateStatusUI' | 'refreshConfigByCurrentConversation' |
    'setReviewerUI' | 'bindReviewerToggleListeners' | 'defaultsChanged' |
    'attachRunningTaskEventStream' | 'refreshLastAssistantProcessDetails' | 'submitWorkflowDecision'>;
}

export interface DomainDependencies {
  doc?: Document;
  i18nReady: Promise<unknown>;
  chat: DomainChatPorts;
  /** Shared shell's element permission policy (the auth page/resource map). */
  permissionAllowedForElement(element: HTMLElement): boolean;
  cycleTheme(): void;
  selectLanguage(locale: string): void;
  uploadWithProgress?: (path: string, form: FormData, options: { onProgress(progress: { percent?: number }): void }) => Promise<Response>;
}
