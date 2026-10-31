import { handleStreamEvent, type StreamEvent, type StreamInput, type StreamPorts } from '@/features/chat/stream/events';
import { finalizeMainResponseStreamItem, markAssistantFinalizationState } from '@/features/chat/timeline/finalize';
import { timelineAgentBracketPrefix } from '@/features/chat/timeline/response-stream';
import { einoMainStreamPlanningTitle, translatePlanExecuteAgentName } from '@/features/chat/timeline/labels';
import { agentPlanTaskDetail } from '@/features/chat/timeline/eino-format';
import { translateProgressMessage } from '@/features/chat/progress/translate';
import { resolveEventBackendMessageId } from '@/features/chat/process/load';
import { autoCancelledExecutionIdsFromData } from '@/features/chat/timeline/tool-calls';
import { formatToolCallTitle } from '@/features/chat/timeline/tool-result';
import type { Trackers } from '@/features/chat/timeline/trackers';
import { browser } from '@/platform/browser';
import type { ChatState } from './state';
import type { ChatTimeline } from './timeline';
import type { ChatMessages } from './messages';
import type { ChatProcess } from './process';
import type { ChatProgress } from './progress';
import type { ChatApprovals } from './approvals';
import { translate, type ChatResources } from './runtime';

export function createChatStream(doc: Document, state: ChatState, trackers: Trackers, resources: ChatResources, deps: {
  locale(): string;
  timeline(): ChatTimeline;
  messages(): ChatMessages;
  process(): ChatProcess;
  progress(): ChatProgress;
  approvals(): ChatApprovals;
  capturePinned(): boolean;
  scrollIfPinned(pinned: boolean): void;
  refreshPrimaryAction(): void;
  updateActiveConversation(): void;
  hideConversationHeader(): void;
  loadActiveTasks(): void;
  loadConversations(): void;
  refreshProjectFolders(): void;
  syncReasoning(backendId: string, assistantId: string): void;
}) {
  const ports: StreamPorts = {
    doc, t: translate, locale: deps.locale, state: state.timeline, pending: trackers.pending,
    currentConversationId: state.conversationId, conversationIsNull: () => !state.conversationId(),
    resolveTimeline: id => deps.timeline().resolveTimeline(id), pinned: deps.capturePinned, scrollIfPinned: deps.scrollIfPinned,
    dispatchAgentPlan(event, conversationId) {
      const detail = agentPlanTaskDetail(event, conversationId, state.conversationId());
      if (detail) browser.dispatch(new CustomEvent('agent-plan-task-event', { detail }));
    },
    applyBackendIdToLastUser: id => deps.timeline().applyLastUserId(id),
    addTimeline: (timeline, type, options) => deps.timeline().addItem(timeline, type, options),
    addMessage: (role, content, mcpIds, progressId) => deps.messages().addMessage(role, content, mcpIds, progressId),
    updateAssistantBubble: (id, content, markdown) => deps.timeline().updateAssistant(id, content, markdown),
    setConversationFromStream(id) { state.setConversationId(id); state.syncHash(id); },
    syncLiveConversation(id) { const live = state.live.get(); if (live?.active) live.conversationId = id; deps.refreshPrimaryAction(); },
    updateActiveConversation: deps.updateActiveConversation, addAttackChainButton: deps.hideConversationHeader,
    loadActiveTasks: deps.loadActiveTasks, loadConversations: deps.loadConversations, refreshProjectFolders: deps.refreshProjectFolders,
    updateProgressConversation: (id, conversationId) => deps.progress().bindConversation(id, conversationId),
    finalizeProgressTask: (id, label) => deps.progress().finalize(id, label), stopElapsedClock: id => deps.progress().stopClock(id),
    translateProgressMessage: (message, data) => translateProgressMessage(message, data as { orchestration?: unknown } | null, translate) ?? message,
    translatePlanPhase: name => translatePlanExecuteAgentName(name, translate), resolveEventBackendMessageId,
    applyBackendIdToAssistantDom: (id, backendId) => deps.timeline().applyAssistantId(id, backendId),
    integrateProgressToMCPSection: (progressId, id, mcpIds, status) => deps.process().integrate(progressId, id, mcpIds, status),
    applyTurnTiming: (id, element, status) => deps.process().applyTiming(id, element, status),
    maybeReloadLazy: id => deps.process().reloadLazy(id), collapseAllProgressDetails: (id, progressId, options) => deps.process().collapse(id, progressId, options),
    hideProgressMessageForFinalReply: id => deps.process().hideProgress(id), clearTimelineStreams: id => deps.timeline().clearStreams(id),
    finalizeOutstandingToolCalls: (id, status) => deps.timeline().finalizeToolCalls(id, status),
    markCancelledExecutions: (root, ids) => { deps.timeline().toolView.markCancelled(root, ids); },
    autoCancelledIds: data => autoCancelledExecutionIdsFromData(data as Parameters<typeof autoCancelledExecutionIdsFromData>[0]),
    updateToolCallStatus: (id, toolId, status) => deps.timeline().toolView.updateStatus(id, toolId, status),
    attachToolResult: (id, toolId, data) => deps.timeline().toolView.attachResult(id, toolId, data),
    mergeIntoCall: (item, data) => { deps.timeline().toolView.mergeResult(item, data); },
    formatToolTitle: (name, index, total) => formatToolCallTitle(name, index, total, translate),
    identityFor: (id, data) => deps.timeline().identity(id, data), findRestoredResponseItem: (timeline, data) => deps.timeline().findRestored(timeline, data),
    restoredResponseState: (id, item, data) => deps.timeline().restoredState(id, item, data),
    finalizeMainResponseItem(stream, message, data) {
      return finalizeMainResponseStreamItem(doc, stream, message, data, {
        flushPlain: el => deps.timeline().painter.flush(el), setPlain: (el, text) => deps.timeline().painter.setPlain(el, text),
        einoPlanningTitle: meta => einoMainStreamPlanningTitle(meta, timelineAgentBracketPrefix(meta), translate),
      });
    },
    markAssistantFinalization: (id, data) => markAssistantFinalizationState(doc, id, data),
    isDirectReplay: id => state.replay()?.progressId === id,
    clearReplayFor: id => { if (state.replay()?.progressId === id) state.setReplay(null); },
    syncReasoningFromServer: deps.syncReasoning,
    renderInlineApproval: (id, data) => deps.approvals().view.renderApproval(id, data),
    resolveInlineDecision: (timeline, data, decision, message) => deps.approvals().view.resolveDecision(timeline, data, decision, message),
    findToolItemForHitl: (timeline, data) => deps.approvals().view.findToolCallItem(timeline, data),
    renderChatDock: data => deps.approvals().renderDock(data), clearChatDock: id => deps.approvals().clearDock(id),
    updateApprovalSidebar: (data, pending) => deps.approvals().sidebar.update(data, pending),
    renderInlineWorkflowApproval: (id, data) => deps.approvals().renderWorkflow(id, data as unknown as import('@/features/chat/hitl-inline/workflow').WorkflowHitlData),
    setStreamPlain: (el, text) => deps.timeline().painter.setPlain(el, text), scheduleStreamPlain: (el, text) => deps.timeline().painter.schedule(el, text),
    flushStreamPlain: el => deps.timeline().painter.flush(el), dispatchWindowEvent: (name, detail) => { browser.dispatch(new CustomEvent(name, { detail })); },
    setTimer: resources.later,
  };
  return { handle(event: StreamEvent, input: StreamInput) { if (!resources.disposed) handleStreamEvent(ports, event, input); } };
}
export type ChatStream = ReturnType<typeof createChatStream>;
