import { createNotificationClient } from './client';
import { createNotificationService } from './service';
import { createNotificationView } from './view';
import type { NotificationDependencies } from './types';
export type { Request, Translate, NotificationDependencies, NotificationItem } from './types';
export { escapeNotificationHtml } from './view';
export function initNotifications(document: Document, deps: NotificationDependencies) {
  const view = createNotificationView(document, deps);
  const service = createNotificationService(createNotificationClient(deps.request), deps, view.render, () => document.hidden);
  let unbind: (() => void) | undefined;
  return { service, activate() { if (unbind) return; unbind = view.bind(service); if (document.getElementById('notification-bell-btn')) service.activate(); },
    dispose() { unbind?.(); service.dispose(); } };
}
