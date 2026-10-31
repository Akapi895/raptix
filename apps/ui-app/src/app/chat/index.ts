import { createPrimaryAction } from '@/features/chat/active/primary-action';
import { createTrackers } from '@/features/chat/timeline/trackers';
import { createChatScroll } from '@/features/chat/scroll';
import { createPlanProgress } from '@/features/chat/plan-progress';
import { createAttackChainContext } from '@/features/attack-chain-context';
import { createChatFiles } from '@/features/chat-files/controller';
import { createChatFilesService } from '@/features/chat-files/service';
import { startChatWorkspace } from '@/features/chat/workspace/workspace';
import { syncAssistantReasoningContent } from '@/features/chat/reasoning-sync';
import { showChatToast } from '@/features/chat/toast';
import { refreshTimelineI18n } from '@/features/chat/timeline/i18n-refresh';
import { timeFormatOptions, einoMainStreamPlanningTitle } from '@/features/chat/timeline/labels';
import { timelineAgentBracketPrefix } from '@/features/chat/timeline/response-stream';
import { translateProgressMessage } from '@/features/chat/progress/translate';
import { formatToolCallTitle } from '@/features/chat/timeline/tool-result';
import type { StreamEvent } from '@/features/chat/stream/events';
import { browser } from '@/platform/browser';
import { storage } from '@/platform/storage';
import { applyTranslations } from '@/i18n';
import { createChatResources, t, translate } from './runtime';
import { createChatState } from './state';
import { createChatSession, type SessionDependencies } from './session';
import { createChatMessages, type MessageDependencies } from './messages';
import { createChatComposer } from './composer';
import { createChatTimeline } from './timeline';
import { createChatProcess } from './process';
import { createChatProgress } from './progress';
import { createChatApprovals, type ApprovalDependencies } from './approvals';
import { createChatStream } from './stream';
import { createChatReplay } from './replay';
import { createChatConversation, type ConversationDependencies } from './conversation';
import { createChatConversations, type ConversationsDependencies } from './conversations';
import { createChatActiveTasks } from './active-tasks';
import { createChatAttackChain } from './attack-chain';
import { createChatMcpDetail, type McpDetailDependencies } from './mcp-detail';

/** Cross-domain capabilities. Callbacks can close over the root's lazy domain getters. */
export interface ChatDependencies {
  document?: Document;
  request(path: string, init?: RequestInit): Promise<Response>;
  upload(path: string, form: FormData, options: { onProgress(progress: { percent?: number }): void }): Promise<Response>;
  allow(permission: string): boolean;
  locale(): string;
  i18nReady?: Promise<unknown>;
  markdown: MessageDependencies['markdown'];
  router: { currentPage(): string; switchPage(page: string): void; cancelScheduledChatConversationFromHash(): void };
  roles: { current(): string; set(role: string): void; select(role: string): void; closePanel(): void };
  projects: ConversationsDependencies['projects'] & ConversationDependencies['projects'] & {
    activeId(): string;
    onChange?(listener: () => void): () => void;
    closePanel(): void;
    refreshFolders(): Promise<void>;
    finishRestore(id: string): void;
    updateTaskStatuses: Parameters<typeof createChatActiveTasks>[3]['updateProjectTaskStatuses'];
    setApprovalStatus: ApprovalDependencies['setProjectStatus'];
    syncApprovalStatuses(items: unknown[]): void;
  };
  hitl: SessionDependencies['hitl'] & {
    syncConversationConfig(id: string): Promise<unknown> | undefined;
    submitDecision: ApprovalDependencies['submitDecision'];
  };
  monitor: {
    statusText(status: string): string;
    conversationOfExecution(id: string): string;
    interruptContext(): { executionId?: unknown } | null;
    setInterruptContext(context: { executionId: string; options: { refreshDetail: boolean } } | null): void;
    refresh(): Promise<void>;
  };
  initPaginationSelects(root: HTMLElement): void;
}

/** One chat application, one set of state owners. Construction never installs page globals. */
export function createChatApplication(input: ChatDependencies) {
  const doc = input.document ?? browser.document;
  const resources = createChatResources();
  const requests = new AbortController();
  const deps: ChatDependencies = {
    ...input,
    request: (path, init) => input.request(path, {
      ...init,
      signal: init?.signal ? AbortSignal.any([requests.signal, init.signal]) : requests.signal,
    }),
  };
  const state = createChatState(deps.router.cancelScheduledChatConversationFromHash, () => primary.update());
  const trackers = createTrackers();
  const toast = (message: unknown, type?: string) => showChatToast(doc, message, type);
  const updateActiveConversation = () => {
    doc.querySelectorAll<HTMLElement>('.conversation-item').forEach(el => el.classList.toggle('active', !!state.conversationId() && el.dataset.conversationId === state.conversationId()));
    const current = doc.getElementById('chat-conversation-current');
    const active = doc.querySelector<HTMLElement>('#conversations-list .conversation-item.active .conversation-title');
    if (current) {
      const id = state.conversationId() || '';
      current.textContent = id ? active?.title || active?.textContent || (current.dataset.conversationId === id ? current.textContent : '') || t('chat.currentConversation', 'Current conversation') : t('chat.newTask', 'New task');
      current.dataset.conversationId = id;
      current.title = current.textContent;
    }
  };
  const hideConversationHeader = () => { const header = doc.getElementById('conversation-header'); if (header) header.style.display = 'none'; };
  const scroll = createChatScroll(doc, {
    translate, conversationId: state.conversationId, liveStream: state.live.get, replayStream: state.replayStream, setReplayStream: state.setReplayStream,
    isTaskRunning: id => activeTasks.sync.isRunning(id),
  });
  const context = createAttackChainContext(doc, { translate: (key, values) => t(key, '', values), copyText: browser.clipboard.writeText });
  const plan = createPlanProgress(doc, { request: deps.request, conversationId: state.conversationId, isTaskRunning: id => activeTasks.sync.isRunning(id), translate });
  const attackChain = createChatAttackChain(doc, resources, { request: deps.request, context });
  const session = createChatSession(doc, state, resources, {
    request: deps.request, allow: deps.allow, closeRolePanel: deps.roles.closePanel, closeProjectPanel: deps.projects.closePanel, hitl: deps.hitl,
  }, toast);
  const messages = createChatMessages(doc, resources, {
    locale: deps.locale, markdown: deps.markdown,
    attachMcpCalls: (element, ids) => process.mcp.setExecutionIds(element, ids), cacheMcpExecutionIds: (element, ids) => process.mcp.cacheExecutionIds(element, ids),
    applyScroll: (_container, options) => scroll.applyMessageScroll(options),
  });
  const timeline = createChatTimeline(doc, state, resources, {
    request: deps.request, locale: deps.locale, appendCopyButton: messages.appendCopyButton,
    attachDeleteButton: el => conversation.attachDeleteButton(el), reloadLazyDetails: id => process.reloadLazy(id),
    registerProgress: (id, conversationId) => progress.register(id, conversationId),
  });
  const process = createChatProcess(doc, state, resources, {
    request: deps.request, timeline: () => timeline,
    hitl: () => ({ renderInlineHitlApproval: approvals.view.renderApproval, resolveInlineHitlDecision: approvals.view.resolveDecision,
      findToolCallItemForHitl: approvals.view.findToolCallItem, restoreWorkflowHitl: approvals.restoreWorkflow }),
    openExecutionDetail: id => mcpDetail.show(id), scrollIfPinned: scroll.scrollIfPinned, capturePinned: scroll.captureScrollPinState,
    scrollIntoView: scroll.scrollIntoViewIfFollowing, openInterrupt: (id, conversationId) => progress.openInterrupt(id, conversationId),
    stopElapsedClock: id => progress.stopClock(id), syncElapsedSummary: id => progress.syncElapsed(id), removeMessage: messages.removeMessage,
  });
  const progress = createChatProgress(doc, state, resources, {
    request: deps.request, loadActiveTasks: () => { void activeTasks.load(false); }, nextSequence: messages.nextSequence,
    capturePinned: scroll.captureScrollPinState, scrollToBottomIfPinned: scroll.scrollIfPinned,
    startLiveFollow: process.follow.startLive, stopLiveFollow: process.follow.stopLive,
    monitor: { interruptContext: deps.monitor.interruptContext, clearInterruptContext: () => deps.monitor.setInterruptContext(null), refresh: deps.monitor.refresh },
  });
  const approvals = createChatApprovals(doc, state, trackers, resources, {
    request: deps.request, submitDecision: deps.hitl.submitDecision, setProjectStatus: deps.projects.setApprovalStatus,
    syncProjectStatuses: deps.projects.syncApprovalStatuses, timeline: () => timeline, process: () => process,
    capturePinned: scroll.captureScrollPinState, scrollIntoView: scroll.scrollIntoViewIfFollowing,
  });
  const reasoningPorts = {
    conversationId: state.conversationId, request: deps.request, setReasoning: messages.setReasoning, loadPaginated: process.loadPage,
    renderDetails: (id: string, details: unknown[]) => process.renderer.render(id, details as Parameters<typeof process.renderer.render>[1]), warn: console.warn,
  };
  const stream = createChatStream(doc, state, trackers, resources, {
    locale: deps.locale, timeline: () => timeline, messages: () => messages, process: () => process, progress: () => progress, approvals: () => approvals,
    capturePinned: scroll.captureScrollPinState, scrollIfPinned: scroll.scrollIfPinned, refreshPrimaryAction: () => primary.update(), updateActiveConversation,
    hideConversationHeader, loadActiveTasks: () => { void activeTasks.load(false); }, loadConversations: () => { void conversations.list.load(); },
    refreshProjectFolders: () => { void deps.projects.refreshFolders(); }, syncReasoning: (backendId, id) => { void syncAssistantReasoningContent(reasoningPorts, backendId, id); },
  });
  const replay = createChatReplay(doc, state, {
    request: deps.request, timeline: () => timeline, process: () => process, progress: () => progress, approvals: () => approvals, stream: () => stream,
    scroll: () => scroll, loadConversation: id => conversation.loadConversation(id), loadConversations: () => { void conversations.list.load(); }, loadActiveTasks: () => { void activeTasks.load(false); },
  });
  const composer = createChatComposer(doc, state, session, resources, {
    request: deps.request, upload: (form, onProgress) => deps.upload('/api/chat-uploads', form, { onProgress: value => onProgress(value.percent ?? 0) }),
    toast, role: deps.roles.current, activeProjectId: deps.projects.activeId, loadActiveTasks: () => activeTasks.load(false),
    isTaskActive: () => primary.isTaskActive(), refreshPrimaryAction: () => primary.update(),
    addUserMessage: text => { messages.addMessage('user', text, null, null, null, { scroll: 'none' }); }, addSystemMessage: text => { messages.addMessage('system', text); },
    removeMessage: messages.removeMessage, notifyTaskStarted: id => activeTasks.sync.notifyStarted(id),
    progress: { start: progress.addMessage, register: progress.register, bindConversation: progress.bindConversation, exists: id => !!doc.getElementById(id), element: id => doc.getElementById(id) },
    handleEvent: (event, context) => stream.handle(event as StreamEvent, {
      progressId: context.progressId, getAssistantId: context.getAssistantId, setAssistantId: context.setAssistantId,
      getMcpIds: context.getExecutionIds, setMcpIds: context.setExecutionIds, conversationId: context.conversationId || undefined,
    }),
    attachReplay: async id => replay.attachRunning(id),
    scroll: { onUserSendMessage: scroll.onUserSendMessage, onStreamEnd: scroll.onStreamEnd, markProgressStreaming: id => scroll.markProgressStreaming(true, id) },
  });
  const conversation = createChatConversation(doc, state, resources, {
    request: deps.request, allow: deps.allow, cancelScheduledHash: deps.router.cancelScheduledChatConversationFromHash, setRole: deps.roles.set, projects: deps.projects,
    syncHitlConfig: deps.hitl.syncConversationConfig, messages: () => messages, composer: () => composer, session: () => session, process: () => process,
    replay: () => replay, approvals: () => approvals, refreshPrimaryAction: () => primary.update(), updateActiveConversation, hideConversationHeader,
    loadConversations: () => { void conversations.list.load(); }, forgetBatch: id => conversations.batch.forget(id),
    closeAttackChainIfNot: id => { if (attackChain.flow.current() !== id) attackChain.close(); }, forceScrollToBottom: () => scroll.forceScrollToBottom(false),
    settleRestoreToBottom: scroll.settleConversationRestoreToBottom, finishRestore: deps.projects.finishRestore,
  });
  const conversations = createChatConversations(doc, state, resources, {
    request: deps.request, locale: deps.locale, allow: deps.allow, projects: deps.projects, initPaginationSelects: deps.initPaginationSelects,
    isRunning: id => activeTasks.sync.isRunning(id), refreshProjectFolders: deps.projects.refreshFolders,
    updateActiveTaskTitle: (id, title) => activeTasks.updateTitle(id, title), deleteConversation: conversation.deleteConversation,
    loadConversation: id => { void conversation.loadConversation(id); }, showAttackChain: id => { void attackChain.show(id); }, updateActiveConversation,
  });
  const activeTasks = createChatActiveTasks(doc, trackers, resources, {
    request: deps.request, locale: deps.locale, approvals: () => approvals, replay: () => replay, progress: () => progress,
    switchPage: deps.router.switchPage, loadConversation: id => { void conversation.loadConversation(id); }, refreshPrimaryAction: () => primary.update(),
    updateProjectTaskStatuses: deps.projects.updateTaskStatuses, setProjectApprovalStatus: deps.projects.setApprovalStatus, syncProjectApprovalStatuses: deps.projects.syncApprovalStatuses,
  });
  const primary = createPrimaryAction({
    doc, t, visibleConversation: state.conversationId, live: state.live.get,
    progressInTranscript: id => !!doc.getElementById(id)?.closest('#chat-messages'), isConversationRunning: activeTasks.sync.isRunning,
    send: () => { void composer.sendMessage(); }, cancelConversation: activeTasks.cancel, cancelProgress: process.cancelProgress,
  });
  const mcpDeps: McpDetailDependencies = {
    request: deps.request, locale: deps.locale, statusText: deps.monitor.statusText, conversationOfExecution: deps.monitor.conversationOfExecution,
    openInterruptDialog(id, context) { progress.openInterrupt(null, id); deps.monitor.setInterruptContext({ executionId: context.executionId, options: { refreshDetail: context.refreshDetail } }); },
    requestCancelWithContinue: async (id, note, context) => { await progress.cancelWithContinue(id, note, context); return true; }, refreshMonitor: deps.monitor.refresh,
  };
  const mcpDetail = createChatMcpDetail(doc, resources, mcpDeps);
  const files = createChatFiles(doc, {
    service: createChatFilesService(deps.request, (path, form, options) => deps.upload(path, form, { onProgress: value => options.onProgress({ percent: value.percent ?? 0 }) })),
    translate, applyTranslations, initPaginationSelects: deps.initPaginationSelects, currentPage: deps.router.currentPage,
    switchPage: deps.router.switchPage, loadConversation: id => { void conversation.loadConversation(id); },
    activeProjectId: deps.projects.activeId, onProjectChange: deps.projects.onChange, allow: deps.allow,
  });
  function refreshI18n() {
    refreshTimelineI18n(doc, {
      t: translate, timeLocale: deps.locale, timeOptions: () => timeFormatOptions(deps.locale()),
      translateProgress: (message, data) => translateProgressMessage(message, data as { orchestration?: unknown } | null, translate) ?? message,
      einoPlanningTitle: meta => einoMainStreamPlanningTitle(meta, timelineAgentBracketPrefix(meta), translate),
      toolCallTitle: (name, index, total) => formatToolCallTitle(name, index, total, translate), syncElapsed: progress.syncElapsed,
      applyToolCallStatus: timeline.toolView.applyStatus, updateToolDetailToggleLabel: timeline.toolView.updateToggleLabel,
      setPlainText: timeline.painter.setPlain, syncAssistantTurn: process.turn.sync, syncMcpToggle: process.mcp.syncToggle,
    });
    messages.refreshSystemReadyMessages();
  }
  let started = false;
  let lastRefresh = Date.now();
  let taskPolling = false;
  function initializeChatUI() {
    if (resources.disposed) return;
    const input = composer.input();
    if (input) {
      composer.fitTextareaHeight(input);
      if (!input.value.trim()) {
        const last = doc.getElementById('chat-messages')?.lastElementChild;
        if (last?.classList.contains('user') && last.querySelector('.message-time')?.textContent) composer.drafts.clear();
        else composer.drafts.restore();
      }
    }
    const area = doc.getElementById('chat-messages'); if (area && !area.childElementCount) messages.renderWelcomeEmptyState();
    hideConversationHeader(); void activeTasks.load(true);
    if (!taskPolling) { taskPolling = true; resources.every(() => { void activeTasks.load(false); }, 2000); }
  }
  async function startList() {
    await deps.i18nReady; if (resources.disposed) return;
    const sidebar = doc.getElementById('conversation-sidebar'); if (sidebar) applyTranslations(sidebar);
    conversations.filter.set(deps.projects.activeId() || '__none__'); conversations.start();
    await conversations.filter.refreshOptions(); if (resources.disposed) return; await conversations.list.load();
  }
  function refreshListIfStale() { if (Date.now() - lastRefresh > 30000) { lastRefresh = Date.now(); void conversations.list.load(); } }
  return {
    state, primary, composer, session, conversation, conversations, messages, timeline, process, progress, approvals, stream, replay,
    activeTasks, attackChain, scroll, context, plan, files, mcpDetail,
    page: { initializeChatUI, updateActiveConversation, hideConversationHeader, toast, refreshI18n,
      syncReasoning: (backendId: string, id: string) => syncAssistantReasoningContent(reasoningPorts, backendId, id),
      onProjectBindingChanged: () => { conversations.filter.set(deps.projects.activeId() || '__none__'); conversations.list.commitPage(1, true); return conversations.list.load(conversations.list.search()); },
      async refreshProjectFilters() { await conversations.filter.refreshOptions(); await conversations.refreshBatchFilter(); },
    },
    start() {
      if (started || resources.disposed) return; started = true;
      session.start(); composer.start(); timeline.start(); scroll.init(); context.activate(); plan.activate(); files.activate(); primary.init();
      resources.own(startChatWorkspace({
        doc, getJson: async path => { const response = await deps.request(path); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); },
        downloadFile: async (path, name) => {
          const response = await deps.request('/api/chat-uploads/download?path=' + encodeURIComponent(path));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const url = URL.createObjectURL(await response.blob());
          const link = doc.createElement('a'); link.href = url; link.download = name;
          doc.body.appendChild(link); link.click(); link.remove();
          browser.setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        hash: () => browser.location.hash, storage, currentPage: deps.router.currentPage,
        currentRole: deps.roles.current, selectRole: deps.roles.select, setInterval: resources.every, clearInterval: browser.clearInterval, now: Date.now,
        ready: () => !!doc.querySelector('#page-chat .chat-page-layout'), layout: () => doc.querySelector<HTMLElement>('#page-chat .chat-page-layout'), hidden: () => doc.hidden,
      }));
      resources.on(browser.events, 'focus', refreshListIfStale);
      resources.on(doc, 'visibilitychange', () => { if (!doc.hidden) refreshListIfStale(); });
      resources.on(doc, 'languagechange', refreshI18n);
      resources.on(doc, 'conversation-deleted', event => {
        const id = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId; if (!id) return;
        doc.querySelectorAll<HTMLElement>('.conversation-item[data-conversation-id]').forEach(el => { if (el.dataset.conversationId === id) el.remove(); });
        if (state.conversationId() === id) { state.setConversationId('', false); const area = doc.getElementById('chat-messages'); if (area) area.innerHTML = ''; messages.renderWelcomeEmptyState(); hideConversationHeader(); }
        void conversations.list.load();
      });
      initializeChatUI(); void startList();
    },
    dispose() {
      if (resources.disposed) return;
      requests.abort(); resources.dispose();
      replay.dispose(); process.dispose(); progress.dispose(); approvals.dispose(); session.dispose(); composer.dispose(); timeline.dispose();
      activeTasks.dispose(); conversations.dispose(); attackChain.dispose(); files.dispose(); plan.dispose(); context.dispose(); scroll.destroy();
      state.dispose();
    },
  };
}
export type ChatApplication = ReturnType<typeof createChatApplication>;
