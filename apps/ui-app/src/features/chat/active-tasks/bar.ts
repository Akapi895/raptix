// The bar of running tasks above the conversation: one item per task that runs, with its status, its name, its start time, and a
// stop button while it can still be stopped. The bar is redrawn only when what it shows has changed, and a task whose
// approval was pending loses its approval when the task is no longer running.

import { escapeHtml } from '../../../ui/format';
import type { TimelineTranslate } from '../timeline/tool-result';

export const FINAL_STATUSES = new Set(['failed', 'timeout', 'cancelled', 'completed', 'cleanup_unconfirmed']);

export interface ActiveTask {
  conversationId?: string;
  title?: string;
  message?: string;
  startedAt?: string;
  status?: string;
}

export interface ActiveTaskDeps {
  doc: Document;
  t: TimelineTranslate;
  locale(): string;
  timeOptions(): Intl.DateTimeFormatOptions;
  /** The app's language, for the signature that decides whether the bar is redrawn. */
  language(): string;
  openConversation(conversationId: string): void;
  cancel(conversationId: string): void;
  onTasks(tasks: ActiveTask[]): void;
  conversationTitleAction?: () => void;
}

/** The tasks in the order they started; a task with no start time goes last. */
export function stableActiveTasksForDisplay(tasks: ActiveTask[] | null | undefined): ActiveTask[] {
  return (Array.isArray(tasks) ? tasks : []).slice().sort((a, b) => {
    const aStartedAt = Date.parse(a && a.startedAt ? a.startedAt : '');
    const bStartedAt = Date.parse(b && b.startedAt ? b.startedAt : '');
    const aTime = Number.isFinite(aStartedAt) ? aStartedAt : Number.MAX_SAFE_INTEGER;
    const bTime = Number.isFinite(bStartedAt) ? bStartedAt : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return String(a && a.conversationId || '').localeCompare(String(b && b.conversationId || ''));
  });
}

/** What the bar shows, as one text: when it changes the bar is redrawn. */
export function activeTasksRenderSignature(tasks: ActiveTask[] | null | undefined, language: string): string {
  return JSON.stringify({
    language,
    tasks: (Array.isArray(tasks) ? tasks : []).map(task => ({
      conversationId: task && task.conversationId || '',
      title: task && task.title || '',
      message: task && task.message || '',
      startedAt: task && task.startedAt || '',
      status: task && task.status || '',
    })),
  });
}

/** The name of a task: its title, else its message, else the unnamed wording. */
export function getActiveTaskDisplayName(task: ActiveTask | null | undefined, t: TimelineTranslate): string {
  const unnamedTaskText = t('tasks.unnamedTask');
  if (!task) return unnamedTaskText;
  const title = (task.title || '').trim();
  if (title) return title;
  const message = (task.message || '').trim();
  return message || unnamedTaskText;
}

/** Changes the name shown for a conversation's task in the bar. */
export function updateActiveTaskConversationTitle(doc: Document, conversationId: string, newTitle: string): void {
  const bar = doc.getElementById('active-tasks-bar');
  if (!bar || !conversationId) return;
  const title = (newTitle || '').trim();
  if (!title) return;
  bar.querySelectorAll('.active-task-item[data-conversation-id="' + conversationId + '"] .active-task-message').forEach(el => {
    el.textContent = title;
  });
}

/** Holds the visual signature of the bar, so an unchanged bar is not redrawn. */
export function createActiveTaskBar(deps: ActiveTaskDeps) {
  let visualSignature = '';
  const doc = deps.doc;
  const t = deps.t;

  /** Redraws the bar for the tasks that are shown now. */
  function render(tasks: ActiveTask[] | null | undefined): void {
    const bar = doc.getElementById('active-tasks-bar') as HTMLElement | null;
    if (!bar) return;
    const normalizedTasks = stableActiveTasksForDisplay(tasks);
    deps.onTasks(normalizedTasks);

    if (normalizedTasks.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      visualSignature = '';
      return;
    }

    bar.style.display = 'flex';
    const nextVisualSignature = activeTasksRenderSignature(normalizedTasks, deps.language());
    if (nextVisualSignature === visualSignature && bar.querySelectorAll('.active-task-item').length === normalizedTasks.length) return;
    const previousScrollLeft = bar.scrollLeft;
    visualSignature = nextVisualSignature;
    bar.innerHTML = '';

    normalizedTasks.forEach(task => {
      const item = doc.createElement('div');
      item.className = 'active-task-item active-task-item-clickable';
      if (task && task.conversationId) {
        item.title = t('tasks.viewConversation');
        item.setAttribute('role', 'button');
        const conversationId = task.conversationId;
        item.onclick = () => deps.openConversation(conversationId);
      }

      const startedTime = task.startedAt ? new Date(task.startedAt) : null;
      const timeText = startedTime && !isNaN(startedTime.getTime())
        ? startedTime.toLocaleTimeString(deps.locale(), deps.timeOptions())
        : '';

      const statusMap: Record<string, string> = {
        running: t('tasks.statusRunning'),
        cancelling: t('tasks.statusCancelling'),
        cleaning: t('tasks.statusCleaning'),
        cleanup_failed: t('tasks.statusCleanupFailed'),
        cleanup_unconfirmed: t('tasks.statusCleanupUnconfirmed'),
        failed: t('tasks.statusFailed'),
        timeout: t('tasks.statusTimeout'),
        cancelled: t('tasks.statusCancelled'),
        completed: t('tasks.statusCompleted'),
      };
      const statusText = statusMap[task.status ?? ''] || t('tasks.statusRunning');
      const isFinalStatus = FINAL_STATUSES.has(task.status ?? '');
      const taskDisplayName = getActiveTaskDisplayName(task, t);
      const stopTaskBtnText = t('tasks.stopTask');

      if (task && task.conversationId) item.dataset.conversationId = task.conversationId;

      item.innerHTML = `
            <div class="active-task-info">
                <span class="active-task-status">${statusText}</span>
                <span class="active-task-message">${escapeHtml(taskDisplayName)}</span>
            </div>
            <div class="active-task-actions">
                ${timeText ? `<span class="active-task-time">${timeText}</span>` : ''}
                ${!isFinalStatus ? '<button class="active-task-cancel">' + stopTaskBtnText + '</button>' : ''}
            </div>
        `;

      // Only a task that is not final can be stopped from the bar.
      if (!isFinalStatus) {
        const cancelBtn = item.querySelector<HTMLButtonElement>('.active-task-cancel');
        if (cancelBtn) {
          cancelBtn.onclick = evt => {
            evt.stopPropagation();
            deps.cancel(task.conversationId ?? '');
          };
          if (task.status === 'cancelling') {
            cancelBtn.disabled = true;
            cancelBtn.textContent = t('tasks.cancelling');
          }
        }
      }
      bar.appendChild(item);
    });
    bar.scrollLeft = previousScrollLeft;
  }

  return { render, reset: () => { visualSignature = ''; } };
}
