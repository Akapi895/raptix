import type { MobileRequest } from './types';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The badge is the sum of tool approvals and pending workflow runs. Each
 * endpoint fails independently, as in the classic mobile runtime. */
export function createMobileService(deps: {
  request: MobileRequest;
  enabled(): boolean;
  loggedOut(): boolean;
  onCount(count: number): void;
}) {
  let disposed = false;
  let generation = 0;
  let pending: AbortController | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  async function count(url: string, field: 'items' | 'runs', signal: AbortSignal): Promise<number> {
    try {
      const response = await deps.request(url, { credentials: 'same-origin', signal });
      if (!response.ok) return 0;
      const data = record(await response.json());
      if (field === 'items' && typeof data.total === 'number' && Number.isFinite(data.total)) return Math.max(0, data.total);
      const list = data[field];
      return Array.isArray(list) ? list.length : 0;
    } catch { return 0; }
  }
  async function refreshHitlBadge(): Promise<void> {
    if (disposed) return;
    const current = ++generation;
    pending?.abort(); pending = undefined;
    if (!deps.enabled()) return;
    if (deps.loggedOut()) { deps.onCount(0); return; }
    const controller = pending = new AbortController();
    const counts = await Promise.all([
      count('/api/hitl/pending?page=1&pageSize=1', 'items', controller.signal),
      count('/api/workflows/runs/pending', 'runs', controller.signal),
    ]);
    if (disposed || current !== generation) return;
    pending = undefined;
    if (deps.enabled()) deps.onCount(deps.loggedOut() ? 0 : counts.reduce((sum, value) => sum + value, 0));
  }
  return {
    refreshHitlBadge,
    start() {
      if (disposed || interval !== undefined) return;
      void refreshHitlBadge();
      interval = setInterval(() => { void refreshHitlBadge(); }, 45_000);
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; pending?.abort(); pending = undefined;
      if (interval !== undefined) clearInterval(interval);
      interval = undefined;
    },
  };
}
