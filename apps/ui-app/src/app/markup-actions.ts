import type { Application } from './application';
import { adaptAction, actionArgument as arg, registerActions, type ArgumentAdapter } from '@/ui/inline-actions';
import { browser } from '@/platform/browser';

function choice<const T extends string>(...values: T[]): ArgumentAdapter<T> {
  return value => {
    if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError('Unknown action option');
    return value as T;
  };
}
const mouseEvent: ArgumentAdapter<MouseEvent> = value => {
  if (!(value instanceof MouseEvent)) throw new TypeError('Expected a mouse event');
  return value;
};

/** Markup can call only these explicit, typed owner closures. Feature binders own
 * their own data-action controls; they are deliberately not duplicated here. */
export function registerMarkupActions({ chat, domains }: Application): () => void {
  const { conversations, session, mcpDetail, attackChain, process, progress } = chat;
  return registerActions({
    abortMCPToolExecutionFromDetail: () => mcpDetail.abortFromDetail(),
    applyBatchConversationFilters: () => conversations.batch.apply(),
    clearDownloadMarkdownSubmenuHideTimeout: () => conversations.context.cancelSubmenuHide(),
    closeAttackChainModal: () => attackChain.close(),
    closeBatchManageModal: () => conversations.batch.close(),
    closeMcpToolAbortModal: () => mcpDetail.closeAbortDialog(),
    closeNodeDetails: () => attackChain.closeDetails(),
    closeUserInterruptModal: () => progress.closeInterrupt(),
    deleteConversationFromContext: () => conversations.context.deleteFromMenu(),
    deleteSelectedConversations: () => conversations.batch.deleteSelected(),
    handleDownloadMarkdownSubmenuEnter: () => conversations.context.showSubmenu(),
    hideDownloadMarkdownSubmenu: () => conversations.context.hideSubmenu(),
    navigateToVulnerabilitiesForContextConversation: () => conversations.context.openVulnerabilities(),
    persistChatAIChannelPref: () => session.picker.persistChannelPref(),
    persistChatReasoningPrefs: () => session.reasoning.persist(),
    pinConversation: () => conversations.context.pin(),
    refreshAttackChain: () => attackChain.refresh(),
    regenerateAttackChain: () => attackChain.regenerate(),
    renameConversation: () => conversations.context.rename(),
    resetAttackChainFilters: () => attackChain.resetFilters(),
    sendMessage: () => chat.composer.sendMessage(),
    showAttackChainFromContext: () => conversations.context.openAttackChain(),
    showBatchManageModal: () => conversations.batch.show(),
    startNewConversation: () => chat.conversation.startNewConversation(),
    submitMcpToolAbortModal: () => mcpDetail.submitAbortDialog(),
    submitUserInterruptContinue: () => progress.submitContinue(),
    submitUserInterruptHardCancel: () => progress.submitHardCancel(),
    toggleConversationReasoningCard: () => session.card.toggleReasoning(),
    toggleRecentConversations: () => conversations.sidebar.toggleRecent(),
    toggleSelectAllBatch: () => conversations.batch.toggleSelectAll(),
    copyActiveMCPResultDetail: adaptAction([arg.element], button => mcpDetail.copyActiveResult(button)),
    copyDetailBlock: adaptAction([choice('detail-request', 'detail-error'), arg.element], (id, button) => mcpDetail.copyBlock(id, button)),
    downloadConversationMarkdownFromContext: adaptAction([arg.boolean], details => conversations.context.downloadMarkdown(details)),
    exportAttackChain: adaptAction([choice('png', 'svg')], format => attackChain.export(format)),
    filterAttackChainByRisk: adaptAction([arg.string], value => attackChain.filterRisk(value)),
    filterAttackChainByType: adaptAction([arg.string], value => attackChain.filterType(value)),
    filterAttackChainNodes: adaptAction([arg.string], value => attackChain.search(value)),
    filterBatchConversations: adaptAction([arg.string], (_value: string) => conversations.batch.filter()),
    handleDownloadMarkdownSubmenuLeave: adaptAction([mouseEvent], event => conversations.context.leaveSubmenu(event)),
    onConversationProjectFilterChange: adaptAction([arg.string], id => conversations.filter.set(id)),
    open: adaptAction([arg.string, choice('_blank')], (url, target) => browser.open(url, target)),
    openChatSessionSettings: adaptAction([choice('hitl'), mouseEvent], (section, event) => session.card.open(section, event)),
    openChatSystemModelPicker: adaptAction([mouseEvent], event => session.picker.open(event)),
    openChatSystemModelView: adaptAction([choice('main', 'channel', 'model', 'mode', 'effort'), mouseEvent], (view, event) => session.picker.openView(view, event)),
    setConversationSortBy: adaptAction([choice('created_at', 'updated_at')], sort => conversations.setSort(sort)),
    switchMCPResultDetailTab: adaptAction([choice('success', 'raw')], tab => mcpDetail.switchResultTab(tab)),
    toggleConversationSortMenu: adaptAction([mouseEvent], event => conversations.toggleSortMenu(event)),
    toggleProgressDetails: adaptAction([arg.string], id => process.toggleProgress(id)),
    cancelProgressTask: adaptAction([arg.string], id => process.cancelProgress(id)),
    showNewProjectModalFromChatSidebar: () => domains.projects.showNewProjectModal('chat'),
    handleProjectFolderSearch: adaptAction([arg.string], value => domains.projects.handleProjectFolderSearch(value)),
  });
}
