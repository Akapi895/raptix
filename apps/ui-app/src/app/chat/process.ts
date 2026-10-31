import { createTurnSummary } from '@/features/chat/process/turn-summary';
import { createMcpSections } from '@/features/chat/process/mcp-section';
import { createProcessRenderer } from '@/features/chat/process/render';
import { createProcessFollow, RESTORE_FOLLOW_MS } from '@/features/chat/process/follow';
import { createReturnLatestController } from '@/features/chat/process/return-latest';
import * as load from '@/features/chat/process/load';
import * as integration from '@/features/chat/process/integrate';
import { getToolExecutionDisplayStatus, formatToolCallTitle, getToolResultDisplayState, getBackgroundRunningToolLabel } from '@/features/chat/timeline/tool-result';
import { coalesceProcessDetailsToolPairs } from '@/features/chat/timeline/tool-calls';
import { formatEinoRunRetryKind, formatEinoRunRetryTitle, formatEinoRunRetryMessage } from '@/features/chat/timeline/eino-format';
import { translatePlanExecuteAgentName, einoMainStreamPlanningTitle } from '@/features/chat/timeline/labels';
import { timelineAgentBracketPrefix } from '@/features/chat/timeline/response-stream';
import { translateProgressMessage } from '@/features/chat/progress/translate';
import { browser } from '@/platform/browser';
import { escapeHtml } from '@/ui/format';
import type { ChatState } from './state';
import type { ChatTimeline } from './timeline';
import { t, translate, type ChatResources } from './runtime';

type RenderPorts = Parameters<typeof createProcessRenderer>[0];
export interface ProcessDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  timeline(): ChatTimeline;
  hitl(): Pick<RenderPorts, 'renderInlineHitlApproval' | 'resolveInlineHitlDecision' | 'findToolCallItemForHitl' | 'restoreWorkflowHitl'>;
  openExecutionDetail(id: string): Promise<void>;
  scrollIfPinned(pinned: boolean): void;
  capturePinned(): boolean;
  scrollIntoView(element: HTMLElement, options: ScrollIntoViewOptions): void;
  openInterrupt(progressId: string, conversationId: string): void;
  stopElapsedClock(id: string): void;
  syncElapsedSummary(id: string): void;
  removeMessage(id: string): void;
}
export function createChatProcess(doc: Document, state: ChatState, resources: ChatResources, deps: ProcessDependencies) {
  const turn = createTurnSummary({ doc, t, now: Date.now, setInterval: resources.every, clearInterval: handle => browser.clearInterval(handle as number) });
  const mcp = createMcpSections({
    doc, t, apiFetch: deps.request, toggleProcessDetails: id => toggle(id), syncTurnSummary: turn.sync,
    openExecutionDetail: deps.openExecutionDetail, displayStatus: raw => getToolExecutionDisplayStatus(raw as { status?: unknown }),
  });
  const returnLatest = createReturnLatestController({
    doc, label: () => t('chat.returnToLatestProcessDetail', 'Jump to latest iteration'), followStates: () => follow.followStates(),
    isStreaming: element => element.classList.contains('is-streaming') || !!element.closest('.progress-container.is-streaming, .process-details-container.is-streaming'),
    loadPage: (id, backendId, options) => loadPage(id, backendId, options),
    continuousLabel: kind => kind === 'older' ? t('chat.loadingEarlierDetails', 'Loading earlier entries…') : kind === 'newer' ? t('chat.loadingLaterDetails', 'Loading newer entries…') : t('common.retry', 'Load failed, click to retry'),
    loadMoreLabel: kind => t('common.loadMore', kind === 'older' ? 'Load earlier entries' : 'Load newer entries'),
    documentOf: element => element.ownerDocument, root: () => doc.getElementById('chat-messages'), setTimeout: resources.later,
  });
  const follow = createProcessFollow({
    doc, returnLatest, scrollChatIfPinned: () => deps.scrollIfPinned(true), requestFrame: resources.frame,
    cancelFrame: resources.cancelFrame, setTimeout: resources.later, clearTimeout: resources.clearTimer, now: Date.now,
  });
  const renderer = createProcessRenderer({
    doc, t, mcp, turn, apiFetch: deps.request, toggleDetails: id => toggle(id),
    title: {
      t, escape: escapeHtml, knowledgeToolName: 'search_knowledge_base',
      einoRetryKind: kind => formatEinoRunRetryKind(translate, kind), einoRetryTitle: data => formatEinoRunRetryTitle(translate, data),
      einoRetryMessage: (message, data) => formatEinoRunRetryMessage(translate, message, data),
      translatePlanExecuteAgent: name => translatePlanExecuteAgentName(name, translate),
      einoPlanningTitle: data => einoMainStreamPlanningTitle(data, timelineAgentBracketPrefix(data), translate),
      toolCallTitle: (name, index, total) => formatToolCallTitle(name, Number(index), Number(total), translate),
      toolResultState: getToolResultDisplayState, backgroundRunningLabel: () => getBackgroundRunningToolLabel(translate),
      translateProgress: message => translateProgressMessage(message, undefined, translate) ?? message,
    },
    addTimelineItem: (timeline, type, options) => deps.timeline().addItem(timeline, type, { ...options, createdAt: options.createdAt as string | number | Date | null }),
    renderInlineHitlApproval: (id, data) => deps.hitl().renderInlineHitlApproval(id, data),
    resolveInlineHitlDecision: (timeline, data, decision, message) => deps.hitl().resolveInlineHitlDecision(timeline, data, decision, message),
    findToolCallItemForHitl: (timeline, data) => deps.hitl().findToolCallItemForHitl(timeline, data),
    restoreWorkflowHitl: id => deps.hitl().restoreWorkflowHitl(id), currentConversationId: state.conversationId,
    ensureReturnLatest: returnLatest.ensureReturnLatestControl, updateReturnLatest: returnLatest.updateReturnLatestControl,
    coalesceToolPairs: details => coalesceProcessDetailsToolPairs(details as Parameters<typeof coalesceProcessDetailsToolPairs>[0]) as typeof details, scheduleFrame: resources.frame,
    scrollBox: () => doc.getElementById('chat-messages'), isUserExpanded: id => renderer.isUserExpanded(id),
  });
  const backendIdOf = (id: string) => doc.getElementById(id)?.dataset.backendMessageId || '';
  const loadPorts: load.LoadDeps = {
    doc, tr: t, request: deps.request, pageSize: 50, restoreFollowMs: RESTORE_FOLLOW_MS,
    hasRenderer: () => true, renderProcessDetails: renderer.render,
    updatePagination(id, backendId, paging) { const el = doc.getElementById(`process-details-${id}`); if (el) returnLatest.updatePaginationButtons(doc, el, id, backendId, paging); },
    startFollow: follow.start, scrollToLatest: follow.scrollToLatest,
    nextFrame: () => new Promise<void>(resolve => resources.frame(() => resolve())), scheduleFrame: resources.frame,
    bindLazyHint: renderer.bindLazyHint, syncButtonLabels: renderer.syncButtonLabels, updateReturnControl: returnLatest.updateReturnLatestControl,
    syncTurnSummary: turn.sync, capturePinned: deps.capturePinned,
    scrollIntoViewIfFollowing(element, options) { deps.scrollIntoView(element, options); return true; },
    replayAssistantDomId: () => state.replayStream()?.active ? state.replay()?.assistantDomId ?? null : null,
    setTimeout: resources.later, openUserInterrupt: deps.openInterrupt,
    progressState: id => state.timeline.progressTasks.get(id), stopButtonFor: id => doc.getElementById(`${id}-stop-btn`) as HTMLButtonElement | null,
    alert: browser.alert, logError: console.error,
  };
  const loadPage = (id: string, backendId: string, options?: Parameters<typeof load.loadProcessDetailsPaginated>[3]) => load.loadProcessDetailsPaginated(loadPorts, id, backendId, options);
  const toggle = (id: string) => load.toggleProcessDetails(loadPorts, id, backendIdOf, true);
  const integratePorts: integration.IntegrateDeps = {
    doc, t: translate, flushStreamText: () => deps.timeline().painter.flushAll(doc),
    finalizeOutstandingToolCalls: (id, status) => deps.timeline().finalizeToolCalls(id, status), removeMessage: deps.removeMessage,
    stopElapsedClock: deps.stopElapsedClock, syncElapsedSummary: deps.syncElapsedSummary, stopLiveFollow: follow.stopLive,
    updateReturnControl: returnLatest.updateReturnLatestControl, ensureMcpChrome: mcp.ensureChrome, setMcpExecutionIds: mcp.setExecutionIds,
    syncMcpToolsToggle: mcp.syncToggle, toggleProcessDetails: (_progressId, id) => toggle(id), renderProcessDetails: renderer.render,
    hasRenderProcessDetails: () => true, bindLazyHint: renderer.bindLazyHint, syncTurnSummary: turn.sync, setTurnTiming: turn.setTiming, now: Date.now,
  };
  return {
    turn, mcp, renderer, follow, returnLatest, loadPage, toggle,
    cancelProgress: (id: string) => load.cancelProgressTask(loadPorts, id),
    reloadLazy: (id: string) => load.maybeReloadLazyProcessDetails(loadPorts, id, backendIdOf),
    scheduleLoad: (id: string, element: HTMLElement, attempt = 0) => load.scheduleProcessDetailsLoadWhenReady(loadPorts, id, element, attempt, backendIdOf),
    integrate: (progressId: string, id: string, mcpIds: unknown, status?: string) => integration.integrateProgressToMCPSection(integratePorts, progressId, id, mcpIds, status, true),
    collapse: (id: string | null, progressId: string | null, options?: { force?: boolean }) => integration.collapseAllProgressDetails(integratePorts, id, progressId, options),
    applyTiming: (progressId: string, element: HTMLElement | null, status: string) => integration.applyAssistantTurnTimingFromProgress(integratePorts, progressId, element, status, true),
    toggleProgress: (id: string) => integration.toggleProgressDetails(integratePorts, id),
    hideProgress: (id: string) => integration.hideProgressMessageForFinalReply(integratePorts, id),
    dispose() {
      follow.stopAll();
      doc.querySelectorAll<HTMLElement>('.process-details-container').forEach(returnLatest.disconnectAutoLoader);
    },
  };
}
export type ChatProcess = ReturnType<typeof createChatProcess>;
