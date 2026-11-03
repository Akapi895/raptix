import { createActiveTaskBar, updateActiveTaskConversationTitle, type ActiveTask } from '@/features/chat/active-tasks/bar';
import { createActiveTasksLoader } from '@/features/chat/active-tasks/load';
import { createTaskSync } from '@/features/chat/timeline/task-sync';
import { TASK_FINAL_STATUSES, type Trackers } from '@/features/chat/timeline/trackers';
import { timeFormatOptions } from '@/features/chat/timeline/labels';
import { browser } from '@/platform/browser';
import { escapeHtml } from '@/ui/format';
import type { ChatApprovals } from './approvals';
import type { ChatReplay } from './replay';
import type { ChatProgress } from './progress';
import { t, translate, type ChatResources } from './runtime';

export function createChatActiveTasks(doc: Document, trackers: Trackers, resources: ChatResources, deps: {
  request(path: string): Promise<Response>;
  locale(): string;
  approvals(): ChatApprovals;
  replay(): ChatReplay;
  progress(): ChatProgress;
  switchPage(page: string): void;
  loadConversation(id: string): void;
  refreshPrimaryAction(): void;
  updateProjectTaskStatuses(tasks: ActiveTask[]): void;
  setProjectApprovalStatus(id: string, pending: boolean): void;
  syncProjectApprovalStatuses(items: unknown[]): void;
}) {
  const reconcileApprovals = (tasks: ActiveTask[]) => {
    const activeIds = new Set(tasks.filter(task => task.conversationId && !TASK_FINAL_STATUSES.has(String(task.status || '').toLowerCase())).map(task => String(task.conversationId)));
    const approvals = deps.approvals();
    approvals.sidebar.state.forEach((_data, id) => {
      if (activeIds.has(id)) return;
      approvals.sidebar.state.delete(id); approvals.sidebar.remove(id); deps.setProjectApprovalStatus(id, false);
    });
    const id = doc.getElementById('chat-hitl-approval-dock')?.dataset.conversationId;
    if (id && !activeIds.has(id)) approvals.clearDock();
  };
  const cancel = (id: string) => { if (id) deps.progress().openInterrupt(deps.progress().find(id), id); };
  const bar = createActiveTaskBar({
    doc, t: translate, locale: deps.locale, timeOptions: () => timeFormatOptions(deps.locale()), language: deps.locale,
    openConversation(id) { if (!id) return; deps.switchPage('chat'); resources.later(() => deps.loadConversation(id), 120); }, cancel,
    onTasks(tasks) {
      if (resources.disposed) return;
      trackers.execution.update(tasks); browser.dispatch(new CustomEvent('conversation-task-state-changed', { detail: { tasks } }));
      deps.approvals().syncTaskAvailability(); reconcileApprovals(tasks); deps.refreshPrimaryAction();
      deps.updateProjectTaskStatuses(tasks); void deps.replay().syncVisible(tasks);
    },
  });
  const load = createActiveTasksLoader({
    request: deps.request, renderTasks: tasks => { if (!resources.disposed) bar.render(tasks); },
    reconcilePending: items => { if (!resources.disposed) deps.approvals().reconcile(items as import('@/features/chat/hitl-inline/restore').PendingItem[]); },
    clearAll() { trackers.pending.update([]); deps.approvals().syncTaskAvailability(); deps.approvals().sidebar.syncState([]); deps.syncProjectApprovalStatuses([]); },
    showError(message) { const el = doc.getElementById('active-tasks-bar'); if (el) { el.style.display = 'block'; el.innerHTML = `<div class="active-task-error">${escapeHtml(message)}</div>`; } },
    translate: t,
  });
  const sync = createTaskSync({
    execution: trackers.execution,
    announceRunning: id => { browser.dispatch(new CustomEvent('conversation-task-state-changed', { detail: { conversationId: id, running: true } })); },
    updateActions: deps.refreshPrimaryAction, refreshActive: () => { void load(false); },
  });
  return { load, render: bar.render, cancel, reconcileApprovals, sync, updateTitle: (id: string, title: string) => updateActiveTaskConversationTitle(doc, id, title), dispose: sync.dispose };
}
export type ChatActiveTasks = ReturnType<typeof createChatActiveTasks>;
