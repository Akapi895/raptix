import { initAuth } from '@/features/auth';
import { translateRuntime, type TranslationOptions } from '@/i18n';
import { browser } from '@/platform/browser';
import { http } from '@/platform/http';
import { closeAppModal, isAppModalOpen, openAppModal } from '@/ui/modal';

export interface AuthDependencies {
  doc: Document;
  ready(): Promise<unknown>;
  initializeChat(): void;
  refreshChat(): Promise<void>;
  robotBindingsChanged(): void;
  notify(message: string, kind: string): void;
}

export function createAuthDomain(deps: AuthDependencies) {
  let initialized = false;
  let disposed = false;
  const tr = (key: string, fallback: string, options?: Record<string, string | number>) => {
    const value = translateRuntime(key, options as TranslationOptions | undefined);
    return value === key ? fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(options?.[name] ?? '')) : value;
  };
  const feature = initAuth({
    doc: deps.doc, t: tr,
    notify: (message, kind) => deps.notify(message, kind ?? 'error'),
    openModal: id => { if (!isAppModalOpen(id)) openAppModal(id); },
    closeModal: id => { closeAppModal(id); }, isModalOpen: isAppModalOpen,
    confirm: browser.confirm,
    onRobotBindingsChanged: deps.robotBindingsChanged,
    async onAuthenticated() {
      if (disposed) return;
      if (!initialized) {
        try { await deps.ready(); } catch (error) { console.warn('Waiting for translations failed', error); }
        if (disposed) return;
        deps.initializeChat(); initialized = true;
        feature.view.applyRbac(deps.doc);
      }
      await deps.refreshChat();
    },
  });
  const { service, view } = feature;
  async function readApiError(response: Response | null, fallback?: string): Promise<string> {
    const base = fallback || tr('auth.requestFailed', 'Request failed');
    if (!response) return base;
    try {
      const body = await response.clone().json() as { error?: string; message?: string };
      return body.error || body.message || base;
    } catch { return base; }
  }
  const notifyApiError = (message: string, kind = 'error') => deps.notify(message.trim() || tr('auth.requestFailed', 'Request failed'), kind);
  return {
    service, view,
    // start binds the login controls synchronously, before its first network await.
    start: feature.start,
    token: service.token,
    hasPermission: service.hasPermission,
    hasAnyPermission: service.hasAnyPermission,
    requirePermission(permission: string | string[], message?: string): boolean {
      const allowed = Array.isArray(permission) ? service.hasAnyPermission(permission) : service.hasPermission(permission);
      if (!allowed) notifyApiError(message ?? tr('auth.forbidden', 'Insufficient permissions'));
      return allowed;
    },
    async apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
      if (disposed) throw new DOMException('Application disposed', 'AbortError');
      await service.ensureAuthenticated();
      if (disposed) throw new DOMException('Application disposed', 'AbortError');
      const response = await http.raw(url, options);
      if (response.status === 401) throw new Error(tr('auth.unauthorized', 'Unauthorized'));
      return response;
    },
    readApiError, notifyApiError,
    async notifyApiResponseError(response: Response | null, fallback?: string) { notifyApiError(await readApiError(response, fallback)); },
    async ensureApiOk(response: Response | null, fallback?: string): Promise<boolean> {
      if (response?.ok) return true;
      notifyApiError(await readApiError(response, fallback)); return false;
    },
    applyRBACToUI: (root: ParentNode = deps.doc) => view.applyRbac(root),
    rbacAfterDynamicRender: (root: ParentNode = deps.doc) => view.applyRbac(root),
    toggleUserMenu: view.commands.toggleUserMenu,
    logout: view.commands.logout,
    openRobotAccountBinding: view.commands.openRobotBinding,
    closeRobotAccountBinding: view.commands.closeRobotBinding,
    generateRobotBindingCode: view.commands.generateBindingCode,
    copyRobotBindingCode: view.commands.copyBindingCode,
    toggleLoginPasswordVisibility: view.commands.togglePassword,
    dispose() { if (disposed) return; disposed = true; feature.dispose(); },
  };
}
export type AuthDomain = ReturnType<typeof createAuthDomain>;
