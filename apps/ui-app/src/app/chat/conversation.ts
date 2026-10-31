import { createConversationLoader, type LoadPorts } from '@/features/chat/conversation/load';
import { createConversationDeleter, attachDeleteTurnButton } from '@/features/chat/conversation/delete';
import { isInterruptContinueInjectChatMessage } from '@/features/chat/messages/text';
import { BACKEND_PROCESSING_PLACEHOLDER } from '@/platform/backend-legacy-strings';
import { terminalState, turnTimestamp, normalizeTokenUsage, mergeTokenUsage } from '@/features/chat/process/turn';
import { showChatToast } from '@/features/chat/toast';
import { detachLiveStream } from '@/features/chat/live-stream';
import { browser } from '@/platform/browser';
import type { ChatState } from './state';
import type { ChatMessages } from './messages';
import type { ChatComposer } from './composer';
import type { ChatSession } from './session';
import type { ChatProcess } from './process';
import type { ChatReplay } from './replay';
import type { ChatApprovals } from './approvals';
import { t, type ChatResources } from './runtime';

export interface ConversationDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  allow(permission: string): boolean;
  cancelScheduledHash(): void;
  setRole(role: string): void;
  projects: {
    resolveSelection(): string;
    setActive(id: string): void;
    setLoaded(id: string): void;
    selectConversation(id: string | null): void;
    refreshSelector(options?: { reloadFolders: boolean; renderFolders: boolean }): unknown;
  };
  syncHitlConfig(id: string): Promise<unknown> | undefined;
  messages(): ChatMessages;
  composer(): ChatComposer;
  session(): ChatSession;
  process(): ChatProcess;
  replay(): ChatReplay;
  approvals(): ChatApprovals;
  refreshPrimaryAction(): void;
  updateActiveConversation(): void;
  hideConversationHeader(): void;
  loadConversations(): void;
  forgetBatch(id: string): void;
  closeAttackChainIfNot(id: string): void;
  forceScrollToBottom(): void;
  settleRestoreToBottom(margin: number): void;
  finishRestore(id: string): void;
}
export function createChatConversation(doc: Document, state: ChatState, resources: ChatResources, deps: ConversationDependencies) {
  const clearComposer = () => {
    const composer = deps.composer(); composer.drafts.clear(); const input = composer.input();
    if (input) { input.value = ''; composer.fitTextareaHeight(input); }
  };
  const ports: LoadPorts = {
    nav: state.navigation, markNavigation: state.navigation.mark, cancelScheduledHash: deps.cancelScheduledHash,
    syncHash: state.syncHash, clearHash: state.clearHash, cancelPendingLoad: state.navigation.cancelPendingLoad,
    detachLiveStream: id => { if (detachLiveStream(state.live.get(), id, false)) deps.refreshPrimaryAction(); },
    cancelRunningTaskReplay: id => deps.replay().cancelRunning(id), clearHitlDock: () => deps.approvals().clearDock(),
    currentConversationId: state.conversationId, setCurrentConversationId: id => state.setConversationId(id || '', false),
    selectProjectItem: deps.projects.selectConversation,
    cachedConversation: id => state.liteCache.get(id) as ReturnType<LoadPorts['cachedConversation']>, putCachedConversation: state.liteCache.put,
    request: deps.request, setLoadedProjectId: deps.projects.setLoaded, setRole: deps.setRole,
    dispatchChanged: id => { browser.dispatch(new CustomEvent('conversation-changed', { detail: { conversationId: id } })); },
    updateActions: deps.refreshPrimaryAction, refreshProjectSelector: () => { deps.projects.refreshSelector({ reloadFolders: false, renderFolders: false }); },
    refreshHitlConfig: () => deps.session().hitl.refreshByCurrentConversation(), syncHitlConfig: deps.syncHitlConfig,
    beginHitlConfigSync: (id, promise) => deps.session().hitl.beginConfigSync(id, promise),
    restoreHitlInline: id => deps.approvals().restoreInline(id), shouldSkipReplay: id => deps.replay().shouldSkipAttach(id), attachRunning: async id => deps.replay().attachRunning(id),
    prefetchLastDetails: () => prefetchLastDetails(), hydrateTokenUsage: (id, seq, signal) => hydrateTokenUsage(id, seq, signal),
    finishRestore: deps.finishRestore, updateActiveConversation: deps.updateActiveConversation, closeAttackChainIfNot: deps.closeAttackChainIfNot,
    addAttackChainButton: deps.hideConversationHeader, messages: () => doc.getElementById('chat-messages'), clearComposer,
    fitComposer: input => deps.composer().fitTextareaHeight(input), renderWelcome: () => deps.messages().renderWelcomeEmptyState(),
    forceScrollToBottom: deps.forceScrollToBottom, settleRestoreToBottom: deps.settleRestoreToBottom,
    addMessage: (role, content, ids, time, options) => deps.messages().addMessage(role, String(content ?? ''), ids, null, time, options),
    messageElement: id => doc.getElementById(id), attachDeleteTurnButton: element => attachDeleteButton(element),
    setTurnTiming: (el, timing) => deps.process().turn.setTiming(el, timing), setReasoning: (el, reasoning) => deps.messages().setReasoning(el, reasoning),
    renderDetails: (id, details) => deps.process().renderer.render(id, details as Parameters<ChatProcess['renderer']['render']>[1]), collapseDetails: id => deps.process().collapse(id, null),
    terminalState, turnTimestamp, isInterruptContinueMessage: isInterruptContinueInjectChatMessage,
    toast: (message, type) => showChatToast(doc, message, type), logWarn: console.warn, logError: console.error,
  };
  const loader = createConversationLoader(ports);
  const clearOpen = () => {
    state.setConversationId('', false); const area = doc.getElementById('chat-messages'); if (area) area.innerHTML = '';
    deps.messages().renderWelcomeEmptyState(); deps.hideConversationHeader();
  };
  const deleter = createConversationDeleter({
    request: deps.request, currentConversationId: state.conversationId, confirm: browser.confirm, alert: browser.alert, translate: t,
    invalidateCache: state.liteCache.invalidate, reloadConversation: loader.loadConversation, loadConversations: deps.loadConversations,
    clearOpenConversation: clearOpen, announceDeleted: id => { doc.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { conversationId: id } })); },
    forgetBatch: deps.forgetBatch, logError: console.error,
  });
  function attachDeleteButton(el: HTMLElement | null) {
    attachDeleteTurnButton(doc, el, t('chat.deleteTurnTitle', 'Delete this turn'), id => { if (deps.allow('chat:delete')) void deleter.deleteTurn(id); });
  }
  async function prefetchLastDetails() {
    const nodes = doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant'); const last = nodes[nodes.length - 1];
    if (!last) return;
    const text = last.querySelector('.message-bubble')?.textContent?.trim();
    if (text !== BACKEND_PROCESSING_PLACEHOLDER && text !== 'Processing...') return;
    if (doc.getElementById(`process-details-${last.id}`)?.dataset.lazyNotLoaded !== '1' || !last.dataset.backendMessageId) return;
    await deps.process().loadPage(last.id, last.dataset.backendMessageId);
  }
  async function hydrateTokenUsage(id: string, seq: number | null, signal?: AbortSignal) {
    if (!id || signal?.aborted) return;
    const response = await deps.request(`/api/conversations/${encodeURIComponent(id)}/token-usage?since=1970-01-01&limit=500`, signal ? { signal } : undefined);
    const payload = await response.json().catch(() => ({})) as { recent?: unknown[] };
    if (!response.ok || resources.disposed || signal?.aborted || (seq != null && seq !== state.navigation.loadSeq()) || state.conversationId() !== id) return;
    const byMessage = new Map<string, ReturnType<typeof normalizeTokenUsage>>();
    for (const row of payload.recent || []) {
      const messageId = String((row as { messageId?: unknown })?.messageId || '').trim(); if (!messageId) continue;
      const usage = normalizeTokenUsage(row); if (usage) byMessage.set(messageId, mergeTokenUsage(byMessage.get(messageId) || null, usage));
    }
    doc.querySelectorAll<HTMLElement>('#chat-messages .message.assistant[data-backend-message-id]').forEach(el => {
      const usage = byMessage.get(el.dataset.backendMessageId || ''); if (usage) deps.process().turn.setTokenUsage(el, usage);
    });
  }
  return {
    ...loader, ...deleter, attachDeleteButton, prefetchLastDetails, hydrateTokenUsage,
    async startNewConversation(options?: { projectId?: unknown }) {
      const projectId = options && Object.prototype.hasOwnProperty.call(options, 'projectId') ? String(options.projectId || '').trim() : deps.projects.resolveSelection();
      state.navigation.mark('', true); deps.cancelScheduledHash(); state.clearHash(); state.navigation.cancelPendingLoad();
      detachLiveStream(state.live.get(), '', true); deps.replay().cancelRunning(''); deps.approvals().clearDock();
      state.setConversationId(''); deps.projects.setLoaded(''); deps.refreshPrimaryAction(); deps.projects.setActive(projectId);
      await deps.projects.refreshSelector(); if (resources.disposed) return;
      clearOpen(); deps.refreshPrimaryAction(); deps.updateActiveConversation(); deps.loadConversations();
      deps.composer().drafts.cancelPending(); clearComposer(); deps.session().hitl.refreshByCurrentConversation();
    },
  };
}
export type ChatConversation = ReturnType<typeof createChatConversation>;
