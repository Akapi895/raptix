// What the page knows about running work: which conversations have a task running, and which approvals still wait for a
// person. Each tracker says whether it has been told the truth yet (`ready`); until then nothing is judged closed.

export const TASK_FINAL_STATUSES = new Set(['failed', 'timeout', 'cancelled', 'completed', 'cleanup_unconfirmed']);

export interface ExecutionTracker {
  ready: boolean;
  update(tasks?: { conversationId?: unknown; status?: unknown }[]): void;
  isRunning(conversationId: string | null | undefined): boolean;
  markRunning(conversationId: unknown): boolean;
}

export interface PendingInterrupt {
  interruptId?: unknown;
  id?: unknown;
  conversationId?: unknown;
  [key: string]: unknown;
}

export interface PendingInterruptTracker {
  ready: boolean;
  update(items?: PendingInterrupt[]): void;
  replaceConversation(conversationId: unknown, items?: PendingInterrupt[]): void;
  add(item: PendingInterrupt | null | undefined): void;
  remove(interruptId: unknown): void;
  has(interruptId: unknown): boolean;
}

export function createExecutionTracker(): ExecutionTracker {
  const activeConversations = new Set<string>();
  const tracker: ExecutionTracker = {
    ready: false,
    update(tasks = []) {
      activeConversations.clear();
      tasks.forEach(task => {
        if (task && task.conversationId && !TASK_FINAL_STATUSES.has(String(task.status))) {
          activeConversations.add(String(task.conversationId));
        }
      });
      tracker.ready = true;
    },
    isRunning(conversationId) {
      return !!conversationId && activeConversations.has(String(conversationId));
    },
    markRunning(conversationId) {
      const id = String(conversationId || '').trim();
      if (!id) return false;
      activeConversations.add(id);
      tracker.ready = true;
      return true;
    },
  };
  return tracker;
}

export function createPendingInterruptTracker(): PendingInterruptTracker {
  const pendingById = new Map<string, PendingInterrupt>();
  const tracker: PendingInterruptTracker = {
    ready: false,
    update(items = []) {
      pendingById.clear();
      items.forEach(item => tracker.add(item));
      tracker.ready = true;
    },
    replaceConversation(conversationId, items = []) {
      const id = String(conversationId || '').trim();
      if (id) {
        pendingById.forEach((item, interruptId) => {
          if (String(item && item.conversationId || '').trim() === id) pendingById.delete(interruptId);
        });
      }
      items.forEach(item => tracker.add(item));
      tracker.ready = true;
    },
    add(item) {
      const interruptId = String(item && (item.interruptId || item.id) || '').trim();
      if (!interruptId || !item) return;
      pendingById.set(interruptId, item);
    },
    remove(interruptId) {
      pendingById.delete(String(interruptId || '').trim());
    },
    has(interruptId) {
      return !!interruptId && pendingById.has(String(interruptId));
    },
  };
  return tracker;
}

export interface Trackers {
  execution: ExecutionTracker;
  pending: PendingInterruptTracker;
  /** Whether an approval is closed: its task has ended, or its interrupt is no longer pending. */
  approvalClosed(conversationId: string, interruptId: string): boolean;
}

export function createTrackers(): Trackers {
  const execution = createExecutionTracker();
  const pending = createPendingInterruptTracker();
  return {
    execution,
    pending,
    approvalClosed(conversationId, interruptId) {
      // A conversation may have started a new task after a restart; an approval whose id is no longer pending stays closed.
      const taskClosed = !!conversationId && execution.ready && !execution.isRunning(conversationId);
      const interruptClosed = !!interruptId && pending.ready && !pending.has(interruptId);
      return taskClosed || interruptClosed;
    },
  };
}
