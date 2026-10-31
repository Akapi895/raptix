import { describe, expect, it, vi } from 'vitest';
import { createStorageService, formatBytes, nonnegativeInt } from './service';
import type { ApiFetch, StorageMeta } from './types';

const meta: StorageMeta = {
  auto_clean: false, interval_minutes: 15, orphan_grace_days: 2, active_grace_hours: 4,
  categories: [
    { key: 'workspace', label: 'Workspace', enabled: true, retention_days: 30, default_retention: 7 },
    { key: 'reduction', label: 'Tool output', enabled: false, retention_days: 0 },
  ],
};

describe('storage service API contract', () => {
  it('loads metadata and cached/forced status independently', async () => {
    const status = { totals: { reclaimable_bytes: 4096, reclaimable_units: 2 } };
    const api = vi.fn<ApiFetch>().mockResolvedValueOnce(Response.json(meta))
      .mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json(status));
    const service = createStorageService(api);
    expect(service.meta).toBeNull();
    expect(service.status).toBeNull();
    await service.loadMeta();
    await service.loadStatus();
    await service.loadStatus(true);
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/storage/meta', '/api/storage/status', '/api/storage/status?refresh=1']);
    expect(service.meta).toEqual(meta);
    expect(service.status).toEqual(status);
  });

  it('previews without confirmation and sends both required flags for real deletion', async () => {
    const api = vi.fn<ApiFetch>().mockImplementation(async () => Response.json({ totals: {} }));
    const service = createStorageService(api);
    await service.cleanup(true);
    await service.cleanup(false);
    expect(api.mock.calls).toEqual([
      ['/api/storage/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"dry_run":true}' }],
      ['/api/storage/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"dry_run":false,"confirm":true}' }],
    ]);
    expect(service.status).toBeNull(); // Cleanup reports do not replace the status cache.
  });

  it('saves only the storage section, accepts an empty success body, and reloads policy without applying config', async () => {
    const api = vi.fn<ApiFetch>().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(meta));
    const service = createStorageService(api);
    const policy = service.policyBase();
    await service.save(policy);
    expect(api.mock.calls).toEqual([
      ['/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage: policy }) }],
      ['/api/storage/meta', undefined],
    ]);
    expect(service.meta).toEqual(meta);
  });

  it('seeds every category, preserves zero retention and disabled categories, and returns detached policy edits', async () => {
    const service = createStorageService(async () => Response.json(meta));
    expect(service.policyBase()).toEqual({ auto_clean: false, interval_minutes: 5, orphan_grace_days: 0, active_grace_hours: 1, categories: {} });
    await service.loadMeta();
    const policy = service.policyBase();
    expect(policy.categories).toEqual({ workspace: { enabled: true, retention_days: 30 }, reduction: { enabled: false, retention_days: 0 } });
    policy.categories.workspace!.retention_days = 0;
    policy.categories.reduction!.enabled = true;
    expect(service.policyBase().categories).toEqual({ workspace: { enabled: true, retention_days: 30 }, reduction: { enabled: false, retention_days: 0 } });
  });

  it('prevents overlapping operations and releases the lock after rejection', async () => {
    const service = createStorageService(vi.fn<ApiFetch>());
    let release = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const first = service.exclusive(() => waiting);
    const skipped = vi.fn();
    expect(service.busy).toBe(true);
    await service.exclusive(skipped);
    expect(skipped).not.toHaveBeenCalled();
    release();
    await first;
    await expect(service.exclusive(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(service.busy).toBe(false);
    await service.exclusive(skipped);
    expect(skipped).toHaveBeenCalledOnce();
  });

  it.each([
    ['meta', 'loadMetaFailed', 'Failed to load the cleanup policy'],
    ['status', 'loadStatusFailed', 'Failed to load storage usage'],
    ['cleanup', 'cleanupFailed', 'Cleanup request failed'],
    ['save', 'saveFailed', 'Save failed'],
  ] as const)('preserves server and translated/default errors for %s', async (operation, key, fallback) => {
    const api = vi.fn<ApiFetch>();
    const service = createStorageService(api);
    const translated = createStorageService(api, name => name === `settingsStorage.${key}` ? 'Translated failure' : name);
    const run = (subject: ReturnType<typeof createStorageService>) => {
      switch (operation) {
        case 'meta': return subject.loadMeta();
        case 'status': return subject.loadStatus();
        case 'cleanup': return subject.cleanup(true);
        case 'save': return subject.save(subject.policyBase());
      }
    };
    api.mockResolvedValueOnce(Response.json({ error: 'Server failure' }, { status: 409 }));
    await expect(run(service)).rejects.toThrow('Server failure');
    api.mockResolvedValueOnce(new Response('not JSON', { status: 500 }));
    await expect(run(service)).rejects.toThrow(fallback);
    api.mockResolvedValueOnce(Response.json({ error: '' }, { status: 500 }));
    await expect(run(translated)).rejects.toThrow('Translated failure');
  });

  it('keeps the last good status on failed reloads', async () => {
    const api = vi.fn<ApiFetch>().mockResolvedValueOnce(Response.json({ totals: { bytes: 1024 } }))
      .mockRejectedValueOnce(new Error('Network disconnected'));
    const service = createStorageService(api);
    await service.loadStatus();
    await expect(service.loadStatus(true)).rejects.toThrow('Network disconnected');
    expect(service.status).toEqual({ totals: { bytes: 1024 } });
  });
});

describe('storage display and retention parsing', () => {
  it.each([[0, '0 B'], [-1, '0 B'], [NaN, '0 B'], [Infinity, '0 B'], [1023, '1023 B'], [1024, '1.0 KB'], [102400, '100 KB'], ['1048576', '1.0 MB'], [1024 ** 5, '1.0 PB']])('formats %s as %s', (value, expected) => {
    expect(formatBytes(value)).toBe(expected);
  });
  it.each([['0', 0], ['15', 15], ['3.9', 3], ['-1', 7], ['', 7], [undefined, 7], ['n/a', 7]])('parses %s with the legacy nonnegative integer rules', (value, expected) => {
    expect(nonnegativeInt(value, 7)).toBe(expected);
  });
});
