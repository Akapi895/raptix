// Keeping the visible conversation in step with its running task: when the task list shows the open conversation as running, its
// events are attached (after the conversation is reloaded, since another tab may have added a turn). Only one sync runs at a time.

const FINAL_TASK_STATUSES = new Set(['failed', 'timeout', 'cancelled', 'completed', 'cleanup_unconfirmed']);

export interface VisibleSyncPorts {
  currentConversationId(): string;
  shouldSkipAttach(conversationId: string): boolean;
  isLoadPending(conversationId: string): boolean;
  loadConversation(conversationId: string): Promise<unknown>;
  attachRunning(conversationId: string): Promise<boolean> | boolean;
  isAttaching(conversationId: string): boolean;
  logWarn(message: string, error: unknown): void;
}

export interface SyncTask {
  conversationId?: string;
  status?: string;
}

/** The sync of the open conversation with its task list. */
export function createVisibleSync(ports: VisibleSyncPorts) {
  let syncPromise: Promise<unknown> | null = null;
  let syncId = '';

  return function syncVisibleConversation(tasks: SyncTask[] | null | undefined): boolean {
    const conversationId = String(ports.currentConversationId() || '').trim();
    if (!conversationId) return false;
    const active = (Array.isArray(tasks) ? tasks : []).some(task =>
      task && String(task.conversationId || '').trim() === conversationId && !FINAL_TASK_STATUSES.has(String(task.status || '').toLowerCase()));
    if (!active) {
      if (syncId === conversationId && !syncPromise) syncId = '';
      return false;
    }
    if (ports.shouldSkipAttach(conversationId)) return false;
    if (ports.isAttaching(conversationId)) return true;
    if (syncPromise && syncId === conversationId) return true;
    syncId = conversationId;
    syncPromise = Promise.resolve()
      .then(async () => {
        // The user may have switched conversation between the queued refresh and this turn: the old one must not be attached.
        if (ports.currentConversationId() !== conversationId) return false;
        if (ports.isLoadPending(conversationId)) return false;
        // Another tab added a user turn and a running assistant turn; the light history is reloaded first, so that the attach does not hang on an old message.
        await ports.loadConversation(conversationId);
        if (ports.currentConversationId() === conversationId && !ports.shouldSkipAttach(conversationId)) {
          return ports.attachRunning(conversationId);
        }
        return false;
      })
      .catch((error: unknown) => {
        ports.logWarn('Failed to sync the running conversation from other tabs:', error);
        return false;
      })
      .finally(() => {
        if (syncId === conversationId) syncPromise = null;
      });
    return true;
  };
}
