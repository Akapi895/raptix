import type { NotificationClient } from './client';
import type { NotificationDependencies, NotificationItem, NotificationModel } from './types';

export const LAST_SEEN_KEY = 'raptix-notification-last-seen-at';
export function hasNotificationTarget(item: NotificationItem): boolean {
  switch (item.type) {
    case 'vulnerability_created': return !!item.vulnerabilityId;
    case 'task_completed': case 'long_running_tasks': return !!item.conversationId;
    case 'task_failed': return !!item.executionId;
    case 'hitl_pending': return true;
    case 'c2_session_online': return !!item.sessionId;
    default: return false;
  }
}
export function createNotificationService(client: NotificationClient, deps: NotificationDependencies,
  render: (model: Readonly<NotificationModel>) => void, hidden: () => boolean) {
  const stored = Number(deps.storage.get(LAST_SEEN_KEY));
  const model: NotificationModel = { items: [], unreadCount: 0, open: false, lastSeenAt: Number.isFinite(stored) && stored > 0 ? stored : 0 };
  let disposed = false, active = false, inFlight = false;
  let timer: number | undefined, opener: number | undefined;
  const emit = () => { if (!disposed) render(model); };
  async function refresh(): Promise<void> {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      const summary = await client.summary(model.lastSeenAt, deps.locale());
      if (disposed) return;
      model.items = Array.isArray(summary?.items) ? summary.items : [];
      const count = Number(summary?.unreadCount);
      model.unreadCount = Math.max(0, summary?.unreadCount !== undefined && Number.isFinite(count) ? count :
        model.items.reduce((n, item) => n + (item.level === 'p0' ? (typeof item.count === 'number' && item.count > 0 ? item.count : 1) : 0), 0));
      emit();
    } finally { inFlight = false; }
  }
  function schedule(): void {
    if (timer !== undefined) deps.runtime.cancel(timer);
    timer = undefined;
    if (!active || disposed) return;
    timer = deps.runtime.after(() => { timer = undefined; void refresh().then(schedule); }, hidden() ? 60_000 : 15_000);
  }
  function close(): void {
    if (opener !== undefined) deps.runtime.cancel(opener);
    opener = undefined; model.open = false; emit();
  }
  function toggle(): void {
    if (disposed) return;
    if (model.open || opener !== undefined) { close(); return; }
    // Dashboard's outside-menu click must finish bubbling before opening.
    opener = deps.runtime.after(() => { opener = undefined; if (disposed) return; model.open = true; emit(); void refresh(); }, 0);
  }
  async function markRead(id: string): Promise<void> {
    if (disposed || !id) return;
    if (await client.read([id]) && !disposed) await refresh();
  }
  async function view(id: string): Promise<void> {
    const item = model.items.find(item => item.id === id);
    if (disposed || !item || !hasNotificationTarget(item)) return;
    deps.navigate(item); close();
    if (item.actionable !== true) await markRead(id);
  }
  async function markAll(): Promise<void> {
    if (disposed || !deps.canMarkAll()) return;
    if (await client.read(model.items.filter(item => item.actionable !== true && item.id).map(item => item.id)) && !disposed) {
      model.lastSeenAt = deps.runtime.now(); deps.storage.set(LAST_SEEN_KEY, String(model.lastSeenAt)); await refresh();
    }
  }
  return {
    refresh, toggle, close, markRead, markAll, view, visibilityChanged: schedule, getModel: () => model,
    activate() { if (active || disposed) return; active = true; void refresh(); schedule(); },
    dispose() { disposed = true; active = false; if (timer !== undefined) deps.runtime.cancel(timer); if (opener !== undefined) deps.runtime.cancel(opener); },
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
