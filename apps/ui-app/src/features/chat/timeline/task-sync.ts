import type { ExecutionTracker } from './trackers';

export const CHAT_TASK_SYNC_CHANNEL_NAME = 'raptix-chat-task-sync-v1';

export interface TaskSyncPorts {
  execution: ExecutionTracker;
  /** Tells the page that a conversation's task started in this tab. */
  announceRunning(conversationId: string): void;
  updateActions(): void;
  /** The server may register the task a moment after the other tab announces it, so the list is read again shortly after. */
  refreshActive(): void;
}

export interface TaskSync {
  notifyStarted(conversationId: string | null | undefined): boolean;
  isRunning(conversationId: string): boolean;
  dispose(): void;
}

/**
 * Tells the other tabs when a task starts, and learns from them. The channel is missing where the browser has no BroadcastChannel;
 * then the tab only knows about the tasks it started itself.
 */
export function createTaskSync(ports: TaskSyncPorts): TaskSync {
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(CHAT_TASK_SYNC_CHANNEL_NAME);
    channel.addEventListener('message', (event: MessageEvent) => {
      const payload = event && event.data;
      if (!payload || payload.type !== 'task-started') return;
      const id = String(payload.conversationId || '').trim();
      if (!id) return;
      ports.execution.markRunning(id);
      ports.updateActions();
      setTimeout(() => ports.refreshActive(), 180);
    });
  }

  return {
    notifyStarted(conversationId) {
      const id = String(conversationId || '').trim();
      if (!id) return false;
      ports.execution.markRunning(id);
      ports.announceRunning(id);
      ports.updateActions();
      channel?.postMessage({ type: 'task-started', conversationId: id, at: Date.now() });
      return true;
    },
    isRunning(conversationId) {
      return ports.execution.isRunning(conversationId);
    },
    dispose() {
      channel?.close();
      channel = null;
    },
  };
}
