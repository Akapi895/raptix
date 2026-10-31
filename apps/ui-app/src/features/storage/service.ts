import { storageText } from './text';
import type { ApiFetch, StorageMeta, StoragePolicy, StorageReport, Translate } from './types';
export function formatBytes(input: unknown): string {
  let value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}
export function nonnegativeInt(input: unknown, fallback: number): number {
  const value = parseInt(String(input), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function createStorageService(api: ApiFetch, translate: Translate = key => key) {
  let meta: StorageMeta | null = null;
  let status: StorageReport | null = null;
  let busy = false;
  async function request(url: string, fallback: string, init?: RequestInit): Promise<Response> {
    const response = await api(url, init);
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
      throw new Error(message || fallback);
    }
    return response;
  }
  const service = {
    get meta() { return meta; }, get status() { return status; }, get busy() { return busy; },
    async exclusive(action: () => Promise<void>): Promise<void> {
      if (busy) return;
      busy = true;
      try { await action(); } finally { busy = false; }
    },
    async loadMeta(): Promise<StorageMeta> {
      const response = await request('/api/storage/meta', storageText(translate, 'loadMetaFailed', 'Failed to load the cleanup policy'));
      const result = await response.json() as StorageMeta;
      meta = result;
      return result;
    },
    async loadStatus(refresh = false): Promise<StorageReport> {
      const response = await request(`/api/storage/status${refresh ? '?refresh=1' : ''}`, storageText(translate, 'loadStatusFailed', 'Failed to load storage usage'));
      const result = await response.json() as StorageReport;
      status = result;
      return result;
    },
    async cleanup(preview: boolean): Promise<StorageReport> {
      const response = await request('/api/storage/cleanup', storageText(translate, 'cleanupFailed', 'Cleanup request failed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview ? { dry_run: true } : { dry_run: false, confirm: true }) });
      return response.json() as Promise<StorageReport>;
    },
    async save(policy: StoragePolicy) {
      // A successful PUT need not return JSON; only metadata is reloaded. No apply/restart.
      await request('/api/config', storageText(translate, 'saveFailed', 'Save failed'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage: policy }) });
      return service.loadMeta();
    },
    policyBase(): StoragePolicy {
      return { auto_clean: meta?.auto_clean ?? false, interval_minutes: meta?.interval_minutes ?? 5, orphan_grace_days: meta?.orphan_grace_days ?? 0, active_grace_hours: meta?.active_grace_hours ?? 1,
        categories: Object.fromEntries((meta?.categories ?? []).map(c => [c.key, { enabled: !!c.enabled, retention_days: nonnegativeInt(c.retention_days, 0) }])) };
    },
  };
  return service;
}
export type StorageService = ReturnType<typeof createStorageService>;
