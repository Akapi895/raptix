import type { ActiveTask } from './bar';

export interface ActiveTasksLoadPorts {
  request(path: string): Promise<Response>;
  renderTasks(tasks: ActiveTask[]): void;
  reconcilePending(items: unknown[]): void;
  /** The page forgets every running task and approval: after a failed read, nothing it showed can still be approved. */
  clearAll(): void;
  /** Shows the failure in the bar, when the caller asked for errors to be visible. */
  showError(message: string): void;
  translate(key: string, fallback: string): string;
}

/**
 * Reads the running tasks and the pending approvals together, and merges them into the page. Calls made while one is in flight share
 * its promise.
 */
export function createActiveTasksLoader(ports: ActiveTasksLoadPorts) {
  let inFlight: Promise<void> | null = null;

  return function loadActiveTasks(showErrors = false): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const [response, pendingResponse] = await Promise.all([
          ports.request('/api/agent-loop/tasks'),
          ports.request('/api/hitl/pending?page=1&pageSize=200').catch(() => null),
        ]);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || ports.translate('tasks.loadActiveTasksFailed', 'Failed to load active tasks'));
        }
        ports.renderTasks(result.tasks || []);
        if (pendingResponse && pendingResponse.ok) {
          const pending = await pendingResponse.json().catch(() => ({}));
          ports.reconcilePending(pending.items || []);
        }
      } catch (error) {
        ports.renderTasks([]);
        ports.clearAll();
        console.error('Failed to load active tasks:', error);
        if (showErrors) {
          const label = ports.translate('tasks.cannotGetTaskStatus', 'Cannot get task status');
          const message = error instanceof Error ? error.message : String(error);
          ports.showError(label + message);
        }
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
