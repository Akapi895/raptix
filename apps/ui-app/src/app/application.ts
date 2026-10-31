import { createDomainApplication } from './domains';
import { createChatApplication, type ChatApplication } from './chat';
import { elementAllowed, pagePermission } from '@/features/auth';
import { normalizeHitlMode, normalizeHitlReviewer, type HitlConfig as ChatHitlConfig } from '@/features/chat/hitl-model';
import type { HitlRecord } from '@/features/chat/hitl-inline/describe';
import { applyProjectDisplayName, formatProjectNameForDisplay } from '@/features/chat/messages/project-name';
import { normalizeAssistantMarkdownSource } from '@/features/chat/timeline/markdown-source';
import { filterActiveProjectsLocal } from '@/features/projects';
import type { Approval } from '@/features/projects';
import type { HitlConfig as HitlFeatureConfig, JsonObject } from '@/features/hitl/types';
import { statusLabel } from '@/ui/format';
import { formatMarkdownToHtml, stripSuspiciousImages } from '@/ui/markdown';
import { theme } from '@/features/theme';
import { changeLanguage, currentLanguage, normalizeLanguage, translateRuntime } from '@/i18n';

/** The HITL configuration of the domain, in the shape the chat page keeps it. */
function chatHitlConfig(config: HitlFeatureConfig): ChatHitlConfig {
  return {
    mode: normalizeHitlMode(config.mode),
    reviewer: normalizeHitlReviewer(config.reviewer),
    sensitiveTools: Array.isArray(config.sensitiveTools) ? config.sensitiveTools.join(', ') : config.sensitiveTools,
    timeoutSeconds: config.timeoutSeconds,
    updatedAt: '',
  };
}

/** The approval the project folders show, read from the pending approval record. */
function approvalFrom(record: HitlRecord | null | undefined): Approval | undefined {
  if (!record) return undefined;
  return {
    interruptId: String(record.interruptId ?? ''),
    conversationId: String(record.conversationId ?? ''),
    status: typeof record.status === 'string' ? record.status : undefined,
  };
}

/** Edited tool arguments are a JSON object or nothing. */
function editedArgumentsFrom(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

/** The only cross-domain composition point. All references are typed owner APIs. */
export function createApplication(i18nReady: Promise<unknown>) {
  // eslint-disable-next-line prefer-const -- assigned after the domains that capture it; the domains only read it lazily.
  let chat: ChatApplication;
  let conversationProjectId = '';
  let configWhitelist: string[] | undefined;
  let interruptContext: { executionId: string; options: { refreshDetail: boolean } } | null = null;
  const domains = createDomainApplication({
    i18nReady,
    cycleTheme: theme.cycle,
    selectLanguage: locale => { void changeLanguage(normalizeLanguage(locale)); },
    permissionAllowedForElement: element => {
      if (!elementAllowed(domains.auth.hasPermission, element)) return false;
      if (element.dataset.page === 'workflows') return domains.auth.hasPermission('workflow:read') || domains.auth.hasPermission('tasks:read');
      const permission = pagePermission(element.dataset.page);
      return !permission || domains.auth.hasPermission(permission);
    },
    chat: {
      initializeChatUI: () => chat.page.initializeChatUI(),
      refreshChatConfig: () => chat.session.loadConfig(),
      loadConversations: query => chat.conversations.list.load(query),
      loadActiveTasks: showErrors => chat.activeTasks.load(showErrors ?? false),
      loadConversation: id => chat.conversation.loadConversation(id),
      startNewConversation: options => chat.conversation.startNewConversation(options),
      currentConversationId: () => chat.state.conversationId(),
      abandonConversation: () => chat.state.navigation.mark('', true),
      conversationsSearchQuery: () => chat.conversations.list.search(),
      setConversationProjectFilter: id => chat.conversations.filter.set(id),
      refreshConversationProjectFilter: () => { void chat.conversations.filter.refreshOptions(); },
      refreshAllProjectFilterSelects: () => chat.page.refreshProjectFilters(),
      getConversationProjectId: () => conversationProjectId,
      setConversationProjectId: id => { conversationProjectId = id; },
      onConversationProjectBindingChanged: () => { void chat.page.onProjectBindingChanged(); },
      refreshChatWelcomeEmptyState: () => chat.messages.renderWelcomeEmptyState(),
      openConversationContextMenu: (event, id, title) => { void chat.conversations.context.open(event, id, title); },
      formatProjectName: name => formatProjectNameForDisplay(name),
      applyProjectName: (element, name, empty) => applyProjectDisplayName(element, name, empty),
      closeChatReasoningPanel: () => chat.session.card.closeReasoning(),
      roleChanged: () => chat.state.markRoleChanged(),
      sendMessage: options => chat.composer.sendMessage(options),
      requireExecutionEvidence: () => chat.state.setFinalizationPolicy({ requireExecutionEvidence: true }),
      refreshChatProjectFoldersAfterAction: () => domains.projects.refreshChatProjectFolders(),
      showMCPDetail: id => chat.mcpDetail.show(id),
      cancelMCPToolExecution: id => chat.mcpDetail.cancel(id),
      closeMCPDetail: () => chat.mcpDetail.close(),
      refreshProgressAndTimelineI18n: () => chat.page.refreshI18n(),
      initChatFilesPage: () => chat.files.initPage(),
      populateChatChannels: ai => chat.session.picker.populateChannels(ai),
      refreshMentionTools: () => chat.composer.mention.refreshTools(),
      reasoning: () => chat.session.reasoning.requestField(),
      hitl: {
        getConversationConfig: id => chat.session.hitl.getForConversation(id),
        saveConversationConfigLocally: (id, config) => chat.session.hitl.saveForConversation(id, chatHitlConfig(config)),
        applyConfigToUI: config => chat.session.hitl.applyToUI(chatHitlConfig(config)),
        readConfigFromForm: () => chat.session.hitl.readFromForm(),
        updateStatusUI: () => chat.session.hitl.updateStatusUI(),
        refreshConfigByCurrentConversation: () => chat.session.hitl.refreshByCurrentConversation(),
        setReviewerUI: reviewer => chat.session.hitl.setReviewerUI(normalizeHitlReviewer(reviewer)),
        bindReviewerToggleListeners: () => chat.session.hitl.bindReviewerToggles(),
        defaultsChanged: () => { chat.session.hitl.refreshByCurrentConversation(); chat.session.summary.updateReasoningSummary(); },
        attachRunningTaskEventStream: async id => chat.replay.attachRunning(id),
        refreshLastAssistantProcessDetails: id => chat.replay.refreshLastDetails(id),
        submitWorkflowDecision: async (id, approved, comment) => { await chat.approvals.submitWorkflow(id, approved, comment); },
      },
    },
  });
  chat = createChatApplication({
    i18nReady,
    request: domains.auth.apiFetch,
    upload: (path, form) => domains.auth.apiFetch(path, { method: 'POST', body: form }),
    allow: domains.auth.requirePermission,
    locale: currentLanguage,
    markdown: {
      available: () => true,
      format: text => formatMarkdownToHtml(text, null, normalizeAssistantMarkdownSource),
      stripSuspiciousImages: root => stripSuspiciousImages(root),
    },
    router: {
      currentPage: domains.router.currentPage, switchPage: domains.router.switchPage,
      cancelScheduledChatConversationFromHash: domains.router.view.cancelScheduledChatConversationFromHash,
    },
    roles: {
      current: () => domains.roles.service.currentRole,
      set: role => { domains.roles.service.setCurrentRole(role); },
      select: domains.roles.view.selectRole, closePanel: domains.roles.view.closePanel,
    },
    projects: {
      projectNames: () => domains.projects.projectNameById,
      ensureProjectsLoaded: domains.projects.ensureProjectsLoaded,
      isProjectsCacheReady: domains.projects.isProjectsCacheReady,
      filterActiveProjects: filterActiveProjectsLocal,
      fetchProjectSummary: domains.projects.fetchProjectSummary,
      activeId: domains.projects.getActiveProjectId,
      onChange: listener => domains.projects.service.subscribe(listener),
      closePanel: domains.projects.closeChatProjectPanel,
      refreshFolders: domains.projects.refreshChatProjectFolders,
      finishRestore: domains.router.view.finishChatConversationRestore,
      updateTaskStatuses: tasks => domains.projects.updateProjectFolderTaskStatuses(
        tasks.flatMap(task => task.conversationId ? [{ conversationId: task.conversationId, status: task.status }] : [])),
      setApprovalStatus: (id, pending, data) => domains.projects.setProjectConversationApprovalStatus(id, pending, approvalFrom(data)),
      syncApprovalStatuses: items => domains.projects.syncProjectConversationApprovalStatuses(items as Approval[]),
      resolveSelection: domains.projects.resolveChatProjectSelection,
      setActive: domains.projects.setActiveProjectId,
      setLoaded: id => { conversationProjectId = id; },
      selectConversation: id => domains.projects.selectChatProjectConversationItem(id ?? ''),
      refreshSelector: domains.projects.refreshChatProjectSelector,
    },
    hitl: {
      serverDefault: domains.hitl.defaults,
      serverReviewer: () => domains.hitl.defaults()?.reviewer,
      globalWhitelist: () => configWhitelist ?? domains.hitl.whitelist(),
      setGlobalWhitelist: list => { configWhitelist = list; },
      defaultReady: () => domains.hitl.ready,
      api: {
        saveConversation: domains.hitl.service.saveConversationConfig,
        putDefault: domains.hitl.service.putDefaultConfig,
        putDefaultReviewer: reviewer => domains.hitl.service.putDefaultConfig({ reviewer }),
        mergeGlobalWhitelist: domains.hitl.service.mergeWhitelist,
        refreshPageWhitelist: () => { void domains.hitl.view.refreshWhitelist(); },
      },
      configLoaded: config => {
        const defaults = domains.hitl.service.getDefaults();
        domains.hitl.service.applyDefaults({ ...defaults, auditBackend: config.auditBackend, auditModel: config.auditModel });
      },
      syncConversationConfig: domains.hitl.service.syncConfigFromServer,
      submitDecision: (id, decision, comment, editedArgs, conversationId) => domains.hitl.service.decide(
        String(id), decision === 'approve' ? 'approve' : 'reject', comment, editedArgumentsFrom(editedArgs), conversationId),
    },
    monitor: {
      statusText: status => statusLabel(status, translateRuntime),
      conversationOfExecution: id => String(domains.monitor.controller.state.executions.find(item => item.id === id)?.conversationId ?? ''),
      interruptContext: () => interruptContext,
      setInterruptContext: context => { interruptContext = context; },
      refresh: async () => { await domains.monitor.controller.refresh(); },
    },
    initPaginationSelects: domains.settings.selects.pagination,
  });
  let disposed = false;
  return {
    domains, chat,
    async start(): Promise<void> {
      const authenticated = domains.start();
      chat.start();
      await Promise.all([authenticated, domains.hitl.ready]);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      chat.dispose();
      await domains.dispose();
    },
  };
}
export type Application = ReturnType<typeof createApplication>;
