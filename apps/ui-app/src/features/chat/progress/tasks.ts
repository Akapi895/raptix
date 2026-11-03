// The progress of a running task on the page: which conversation a progress belongs to, the requests that stop a task
// (a hard stop, or a stop that continues the run after the tool that was running), the interrupt dialog's choice, and the
// elapsed time the progress card shows. The page's fetches, timers and dialogs come in through `deps`.

import type { ProgressTaskState } from '../timeline/stream-state';
import type { TimelineTranslate } from '../timeline/tool-result';

export interface ProgressDeps {
  doc: Document;
  t: TimelineTranslate;
  tasks: Map<string, ProgressTaskState>;
  /** The conversation the page shows now. */
  currentConversationId(): string | null | undefined;
  request(path: string, init: RequestInit): Promise<Response>;
  loadActiveTasks(): void;
  alert(message: string): void;
  logError(message: string, error: unknown): void;
}

/** A translation, or the fallback when the page has none. */
export function wording(t: TimelineTranslate, key: string, fallback: string): string {
  const value = t(key);
  return value && value !== key ? value : fallback;
}

/** Asks the server to stop a conversation's task, and returns its answer. */
export async function requestCancel(deps: ProgressDeps, conversationId: string): Promise<Record<string, unknown>> {
  const response = await deps.request('/api/agent-loop/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || wording(deps.t, 'tasks.cancelFailed', 'Cancel failed'));
  return result as Record<string, unknown>;
}

/**
 * Stops only the tool call that is running: the tool returns, and the reasoning of the round goes on. The reason, when there
 * is one, joins the tool's result.
 */
export async function requestCancelWithContinue(
  deps: ProgressDeps,
  conversationId: string,
  reason: string,
  options: { executionId?: unknown } = {},
): Promise<Record<string, unknown>> {
  const executionId = options.executionId ? String(options.executionId).trim() : '';
  const body: Record<string, unknown> = { conversationId, reason: reason || '', continueAfter: true };
  if (executionId) body.executionId = executionId;
  const response = await deps.request('/api/agent-loop/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || wording(deps.t, 'tasks.cancelFailed', 'Cancel failed'));
  return result as Record<string, unknown>;
}

/** Records the conversation of a progress, and takes the progress element's conversation id from it. */
export function registerProgressTask(deps: ProgressDeps, progressId: string, conversationId: string | null = null): void {
  const state: ProgressTaskState = deps.tasks.get(progressId) ?? {};
  state.conversationId = conversationId !== undefined && conversationId !== null
    ? conversationId
    : (state.conversationId ?? deps.currentConversationId() ?? null);
  state.cancelling = false;
  deps.tasks.set(progressId, state);
  const progressElement = deps.doc.getElementById(progressId);
  if (progressElement) progressElement.dataset.conversationId = state.conversationId || '';
}

export function updateProgressConversation(deps: ProgressDeps, progressId: string, conversationId: string | null | undefined): void {
  if (!conversationId) return;
  registerProgressTask(deps, progressId, conversationId);
}

export function markProgressCancelling(deps: ProgressDeps, progressId: string): void {
  const state = deps.tasks.get(progressId);
  if (state) state.cancelling = true;
}

/** Finishes a progress: its stop button shows the final label and is disabled, and the progress leaves the registry. */
export function finalizeProgressTask(deps: ProgressDeps, progressId: string, finalLabel: string | undefined, stopProgressFollow: (progressId: string) => void): void {
  stopProgressFollow(progressId);
  const stopBtn = deps.doc.getElementById(`${progressId}-stop-btn`) as HTMLButtonElement | null;
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = finalLabel !== undefined && finalLabel !== '' ? finalLabel : wording(deps.t, 'tasks.statusCompleted', 'Completed');
  }
  deps.tasks.delete(progressId);
}

/** The progress that shows a conversation: the one on the page first, else the last one that was registered for it. */
export function findProgressIdByConversationId(deps: ProgressDeps, conversationId: string | null | undefined): string | null {
  if (!conversationId) return null;
  let fallback: string | null = null;
  for (const [pid, st] of deps.tasks) {
    if (st && st.conversationId === conversationId) {
      fallback = pid;
      if (deps.doc.getElementById(pid)) return pid;
    }
  }
  return fallback;
}

/** The state of the interrupt dialog: which progress and conversation it acts on. */
export interface InterruptTarget {
  progressId: string | null;
  conversationId: string;
}

export interface InterruptDialog {
  pending: InterruptTarget | null;
  open(progressId: unknown, conversationId: string): void;
  close(): void;
}

export function createInterruptDialog(deps: ProgressDeps, openModal: (id: string) => void, closeModal: (id: string) => void): InterruptDialog {
  const dialog: InterruptDialog = {
    pending: null,
    open(progressId, conversationId) {
      dialog.pending = {
        progressId: progressId != null && progressId !== '' ? String(progressId) : null,
        conversationId: String(conversationId),
      };
      const ta = deps.doc.getElementById('user-interrupt-reason') as HTMLTextAreaElement | null;
      if (ta) ta.value = '';
      openModal('user-interrupt-modal');
    },
    close() {
      dialog.pending = null;
      closeModal('user-interrupt-modal');
    },
  };
  return dialog;
}

/** The hard stop of a progress: its stop button shows that it is being cancelled, and a second press waits for the first. */
export async function performHardCancelProgressTask(deps: ProgressDeps, progressId: string, conversationId = ''): Promise<void> {
  const state = deps.tasks.get(progressId);
  const stopBtn = deps.doc.getElementById(`${progressId}-stop-btn`) as HTMLButtonElement | null;
  const targetConversationId = String(conversationId || (state && state.conversationId) || '').trim();

  if (!targetConversationId) {
    if (stopBtn) {
      stopBtn.disabled = true;
      setTimeout(() => { stopBtn.disabled = false; }, 1500);
    }
    deps.alert(wording(deps.t, 'tasks.taskInfoNotSynced', 'Task details are not synced yet; try again shortly.'));
    return;
  }
  if (state && state.cancelling) return;

  markProgressCancelling(deps, progressId);
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = wording(deps.t, 'tasks.cancelling', 'Cancelling...');
  }
  try {
    await requestCancel(deps, targetConversationId);
    deps.loadActiveTasks();
  } catch (error) {
    deps.logError('Failed to cancel task:', error);
    deps.alert(wording(deps.t, 'tasks.cancelTaskFailed', 'Failed to cancel the task') + ': ' + (error instanceof Error ? error.message : String(error)));
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.textContent = wording(deps.t, 'tasks.stopTask', 'Stop task');
    }
    const currentState = deps.tasks.get(progressId);
    if (currentState) currentState.cancelling = false;
  }
}
