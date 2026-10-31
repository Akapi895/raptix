export interface NotificationRuntime {
  now(): number;
  after(callback: () => void, ms: number): number;
  cancel(id: number): void;
  every(callback: () => void, ms: number): number;
  cancelEvery(id: number): void;
}

export const notificationBrowser = {
  now: () => Date.now(),
  after: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  cancel: (id: number) => window.clearTimeout(id),
  every: (callback: () => void, ms: number) => window.setInterval(callback, ms),
  cancelEvery: (id: number) => window.clearInterval(id),
  hash: (hash: string) => { window.location.hash = hash; },
  reload: () => window.location.reload(),
  restarted: () => window.location.replace(window.location.pathname + '?restarted=' + Date.now() + '#system-update'),
  // Deliberately bypass apiFetch: a 401 here means the new process is ready,
  // not a session-expiry event that should redirect before the watchdog sees it.
  probe: () => window.fetch('/api/system/update', {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  }),
};
