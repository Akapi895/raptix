import { createTaskReplay, assistantMessageNeedsReconcile, reconcileAfterTaskReplay, refreshLastAssistantDetails, type ReplayPorts } from '@/features/chat/replay/attach';
import { createVisibleSync } from '@/features/chat/replay/visible';
import { findLastAssistantMessageElInChat } from '@/features/chat/hitl-inline/restore';
import type { createChatScroll } from '@/features/chat/scroll';
import type { ChatState } from './state';
import type { ChatTimeline } from './timeline';
import type { ChatProcess } from './process';
import type { ChatProgress } from './progress';
import type { ChatApprovals } from './approvals';
import type { ChatStream } from './stream';
import type { StreamEvent } from '@/features/chat/stream/events';
import { t } from './runtime';

export function createChatReplay(doc: Document, state: ChatState, deps: {
  request(path: string, init?: RequestInit): Promise<Response>;
  timeline(): ChatTimeline;
  process(): ChatProcess;
  progress(): ChatProgress;
  approvals(): ChatApprovals;
  stream(): ChatStream;
  scroll(): ReturnType<typeof createChatScroll>;
  loadConversation(id: string): Promise<unknown>;
  loadConversations(): void;
  loadActiveTasks(): void;
}) {
  function shouldSkipAttach(id: string) {
    const live = state.live.get();
    return !!live?.active && !!live.progressId && !!doc.getElementById(live.progressId) && (live.conversationId == null || live.conversationId === id);
  }
  const ports: ReplayPorts = {
    doc, request: deps.request, currentConversationId: state.conversationId,
    findLastAssistant: () => findLastAssistantMessageElInChat(doc), assistantNeedsReconcile: assistantMessageNeedsReconcile,
    reconcileAfterReplay: (id, following) => reconcileAfterTaskReplay(ports, id, following), shouldSkipAttach,
    loadPaginated: async (id, backendId, options) => { await deps.process().loadPage(id, backendId, options); },
    restoreHitlInline: async id => { await deps.approvals().restoreInline(id); }, expandDetails: id => deps.approvals().expandDetails(id),
    beginReplay: (id, assistantId, conversationId) => deps.timeline().beginReplay(id, assistantId, conversationId),
    replayProgressId: id => deps.timeline().replayProgressId(id), clearReplay: () => state.setReplay(null),
    replayProgressIdOf: () => state.replay()?.progressId ?? null, replayConversationIdOf: () => state.replay()?.conversationId ?? null,
    replayProgressOf: id => state.replay()?.progressId === id,
    scrollBegin: (id, assistantId, progressId) => deps.scroll().onTaskEventStreamBegin(id, assistantId, progressId),
    scrollEnd: () => deps.scroll().onTaskEventStreamEnd(), startFollow: (id, options) => deps.process().follow.start(id, options),
    stopFollow: id => deps.process().follow.stop(id), stopAllFollow: () => deps.process().follow.stopAll(),
    settleToBottom: margin => deps.scroll().settleToBottomIfFollowing(margin), forceScrollToBottom: () => deps.scroll().forceScrollToBottom(false),
    scrollIsRaptixAvailable: () => true, capturePinned: () => deps.scroll().captureScrollPinState(),
    progress: { has: id => state.timeline.progressTasks.has(id), remove: id => { state.timeline.progressTasks.delete(id); } },
    loadConversations: deps.loadConversations, finalizeProgress: (id, label) => deps.progress().finalize(id, label),
    finalizeWithLabelDone: () => t('tasks.statusCompleted', 'Completed'), loadActiveTasks: deps.loadActiveTasks, loadConversation: deps.loadConversation,
    collapseAll: (id, progressId, options) => deps.process().collapse(id, progressId, options),
    onEvent: (event, progressId, conversationId, assistantId, mcp) => deps.stream().handle(event as StreamEvent, {
      progressId, conversationId, getAssistantId: () => assistantId, setAssistantId: () => undefined,
      getMcpIds: mcp.get, setMcpIds: ids => mcp.merge(ids),
    }),
    readStreamLines: (lines, onEvent) => deps.timeline().processSseDataLines(lines, onEvent), newDecoder: () => new TextDecoder(), logWarn: console.warn,
    hasAssistantTurnTiming: () => true, setAssistantTurnTiming: (el, timing) => deps.process().turn.setTiming(el, timing),
    updateAssistantBubble: (id, content) => deps.timeline().updateAssistant(id, content, true),
    applyBackendIdToAssistant: (id, backendId) => deps.timeline().applyAssistantId(id, backendId),
  };
  const replay = createTaskReplay(ports);
  const syncVisible = createVisibleSync({
    currentConversationId: state.conversationId, shouldSkipAttach, isLoadPending: state.navigation.isLoadPending,
    loadConversation: deps.loadConversation, attachRunning: replay.attachRunning, isAttaching: replay.isAttaching, logWarn: console.warn,
  });
  return {
    ...replay, shouldSkipAttach, syncVisible,
    refreshLastDetails: (id: string) => refreshLastAssistantDetails(ports, id),
    reconcile: (id: string, following: boolean) => reconcileAfterTaskReplay(ports, id, following),
    dispose() { replay.cancelRunning(''); state.setReplay(null); },
  };
}
export type ChatReplay = ReturnType<typeof createChatReplay>;
