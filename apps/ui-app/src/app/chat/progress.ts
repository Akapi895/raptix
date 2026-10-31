import * as tasks from '@/features/chat/progress/tasks';
import * as cards from '@/features/chat/progress/card';
import { formatTurnDuration } from '@/features/chat/process/turn';
import { openAppModal, closeAppModal } from '@/ui/modal';
import { browser } from '@/platform/browser';
import type { ChatState } from './state';
import { t, translate, type ChatResources } from './runtime';

export interface ProgressDependencies {
  request(path: string, init?: RequestInit): Promise<Response>;
  loadActiveTasks(): void;
  nextSequence(): number;
  capturePinned(): boolean;
  scrollToBottomIfPinned(pinned: boolean): void;
  startLiveFollow(id: string): void;
  stopLiveFollow(id: string): void;
  monitor: {
    interruptContext(): { executionId?: unknown } | null;
    clearInterruptContext(): void;
    refresh(): Promise<void>;
  };
}
export function createChatProgress(doc: Document, state: ChatState, resources: ChatResources, deps: ProgressDependencies) {
  const progress: tasks.ProgressDeps = {
    doc, t: translate, tasks: state.timeline.progressTasks, currentConversationId: () => state.conversationId() || null,
    request: deps.request, loadActiveTasks: deps.loadActiveTasks, alert: browser.alert, logError: console.error,
  };
  const dialog = tasks.createInterruptDialog(progress, openAppModal, closeAppModal);
  const card: cards.CardDeps = {
    doc, t: translate, formatDuration: ms => formatTurnDuration(ms, t), currentConversationId: progress.currentConversationId,
    nextSequence: deps.nextSequence, messagesContainer: () => doc.getElementById('chat-messages'),
    scrollToBottomIfPinned: deps.scrollToBottomIfPinned, capturePinned: deps.capturePinned, startLiveFollow: deps.startLiveFollow,
    setInterval: resources.every, clearInterval: browser.clearInterval,
  };
  return {
    register: (id: string, conversationId: string | null = null) => tasks.registerProgressTask(progress, id, conversationId),
    bindConversation: (id: string, conversationId: string | null | undefined) => tasks.updateProgressConversation(progress, id, conversationId),
    markCancelling: (id: string) => tasks.markProgressCancelling(progress, id),
    finalize: (id: string, label?: string) => tasks.finalizeProgressTask(progress, id, label, deps.stopLiveFollow),
    find: (conversationId: string | null | undefined) => tasks.findProgressIdByConversationId(progress, conversationId),
    cancel: (conversationId: string) => tasks.requestCancel(progress, conversationId),
    cancelWithContinue: (conversationId: string, reason: string, options?: { executionId?: unknown }) => tasks.requestCancelWithContinue(progress, conversationId, reason, options),
    openInterrupt: dialog.open, closeInterrupt: dialog.close,
    async submitContinue() {
      const pending = dialog.pending; if (!pending) return;
      const reason = ((doc.getElementById('user-interrupt-reason') as HTMLTextAreaElement | null)?.value || '').trim();
      const monitor = deps.monitor.interruptContext();
      dialog.close();
      const stop = pending.progressId ? doc.getElementById(`${pending.progressId}-stop-btn`) as HTMLButtonElement | null : null;
      try {
        if (stop) { stop.disabled = true; stop.textContent = tasks.wording(translate, 'tasks.interruptSubmitting', 'Submitting...'); }
        await tasks.requestCancelWithContinue(progress, pending.conversationId, reason, { executionId: monitor?.executionId ?? '' });
        if (monitor?.executionId) { await deps.monitor.refresh(); deps.monitor.clearInterruptContext(); }
        deps.loadActiveTasks();
      } catch (error) {
        console.error('Interrupt-and-continue failed:', error);
        browser.alert(`${tasks.wording(translate, 'tasks.cancelTaskFailed', 'Operation failed')}: ${error instanceof Error ? error.message : String(error)}`);
      } finally { if (stop) { stop.disabled = false; stop.textContent = tasks.wording(translate, 'tasks.stopTask', 'Stop task'); } }
    },
    async submitHardCancel() {
      const pending = dialog.pending; if (!pending) return;
      dialog.close();
      if (pending.progressId) return tasks.performHardCancelProgressTask(progress, pending.progressId, pending.conversationId);
      if (!pending.conversationId) return;
      try { await tasks.requestCancel(progress, pending.conversationId); deps.loadActiveTasks(); }
      catch (error) { console.error('Cancel task failed:', error); browser.alert(`${tasks.wording(translate, 'tasks.cancelTaskFailed', 'Failed to cancel task')}: ${error instanceof Error ? error.message : String(error)}`); }
    },
    hardCancel: (id: string, conversationId?: string) => tasks.performHardCancelProgressTask(progress, id, conversationId),
    elapsedText: (id: string) => cards.progressElapsedText(card, id),
    syncElapsed: (id: string) => cards.syncProgressElapsedSummary(card, id),
    stopClock: (id: string) => cards.stopProgressElapsedClock(card, id),
    startClock: (id: string) => cards.startProgressElapsedClock(card, id),
    addMessage: () => cards.addProgressMessage(card),
    dispose() { dialog.close(); for (const id of state.timeline.progressTasks.keys()) cards.stopProgressElapsedClock(card, id); },
  };
}
export type ChatProgress = ReturnType<typeof createChatProgress>;
