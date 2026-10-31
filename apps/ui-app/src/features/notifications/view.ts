import type { NotificationDependencies, NotificationModel } from './types';
import { hasNotificationTarget, type NotificationService } from './service';

export function escapeNotificationHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function createNotificationView(document: Document, deps: NotificationDependencies) {
  const e = escapeNotificationHtml;
  const t = (key: string, fallback: string) => { try { const text = deps.translate(key); return text && text !== key ? text : fallback; } catch { return fallback; } };
  function render(model: Readonly<NotificationModel>): void {
    const badge = document.getElementById('notification-badge'), bell = document.getElementById('notification-bell-btn');
    if (badge && bell) {
      badge.style.display = model.unreadCount > 0 ? 'inline-block' : 'none';
      badge.innerHTML = '<span class="notification-badge-text">' + e(model.unreadCount > 99 ? '99+' : model.unreadCount) + '</span>';
      bell.classList.toggle('has-alert', model.unreadCount > 0); bell.classList.toggle('active', model.open);
      bell.setAttribute('aria-expanded', String(model.open));
    }
    const dropdown = document.getElementById('notification-dropdown'); if (dropdown) dropdown.style.display = model.open ? 'block' : 'none';
    const list = document.getElementById('notification-list'); if (!list) return;
    list.innerHTML = model.items.slice(0, 20).map(item => {
      const ms = item.ts ? new Date(item.ts).getTime() : 0;
      const time = ms && Number.isFinite(ms) ? new Date(ms).toLocaleString(deps.locale()) : '-';
      return `<div class="notification-item notification-level-${e(item.level || 'p2')}"><div class="notification-item-header"><div class="notification-item-title">${e(item.title || t('notifications.itemDefaultTitle', 'Notification'))}</div><div class="notification-item-actions">${hasNotificationTarget(item) ? `<button class="notification-item-action-btn notification-item-view-btn" type="button" data-notification-action="view" data-action-id="${e(item.id)}">${e(t('common.view', 'View'))}</button>` : ''}${item.actionable !== true && item.id ? `<button class="notification-item-action-btn notification-item-read-btn" type="button" data-notification-action="read" data-notification-id="${e(item.id)}">${e(t('notifications.markSingleRead', 'Read'))}</button>` : ''}</div></div><div class="notification-item-desc">${e(item.desc)}</div><div class="notification-item-time">${e(time)}</div></div>`;
    }).join('') || '<div class="notification-empty">' + e(t('notifications.empty', 'No new events')) + '</div>';
  }
  function bind(service: NotificationService): () => void {
    const click = (event: Event) => {
      const target = event.target; if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>('[data-notification-action]');
      if (button && !button.matches(':disabled, [aria-disabled="true"]')) {
        event.preventDefault(); event.stopPropagation();
        switch (button.dataset.notificationAction) {
          case 'notifications.toggle': service.toggle(); break;
          case 'notifications.markAll': void service.markAll(); break;
          case 'view': void service.view(button.dataset.actionId || ''); break;
          case 'read': void service.markRead(button.dataset.notificationId || ''); break;
        }
      } else if (!document.querySelector('.notification-menu-container')?.contains(target)) service.close();
    };
    const language = () => { void service.refresh(); }, visibility = () => service.visibilityChanged();
    document.addEventListener('click', click); document.addEventListener('languagechange', language); document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('click', click); document.removeEventListener('languagechange', language); document.removeEventListener('visibilitychange', visibility); };
  }
  return { render, bind };
}
