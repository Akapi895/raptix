import { describe, expect, it, vi } from 'vitest';
import { initStorage } from './index';
import type { ApiFetch, StorageMeta, StorageReport } from './types';

// A small DOM port keeps these controller tests in Vitest's node environment.
// HTML strings are exercised by the real view; API/state logic uses the real service.
class Field extends EventTarget {
  innerHTML = '';
  textContent = '';
  className = '';
  hidden = true;
  disabled = false;
  checked = false;
  value = '';
  dataset: Record<string, string> = {};
  style = { width: '' };
  classList = { toggle: vi.fn() };
  attributes = new Map<string, string>();
  removeAttribute(name: string) { this.attributes.delete(name); }
}

function fixture() {
  const ids = ['settings-section-storage', 'storage-category-rows', 'storage-overview', 'storage-usage-bar-fill',
    'storage-disk-used', 'storage-disk-detail', 'storage-total-bytes', 'storage-total-units', 'storage-reclaimable-bytes',
    'storage-reclaimable-units', 'storage-inodes', 'storage-scanned-at', 'storage-result', 'storage-auto-clean',
    'storage-interval-minutes', 'storage-orphan-grace-days', 'storage-active-grace-hours'];
  const fields = new Map(ids.map(id => [id, new Field()]));
  const field = (id: string) => fields.get(id)!;
  const buttons = ['storage.refresh', 'storage.preview', 'storage.cleanup', 'storage.save'].map(action => {
    const button = new Field(); button.dataset.action = action; return button;
  });
  const retention: Field[] = [], enabled: Field[] = [];
  const section = Object.assign(field('settings-section-storage'), {
    querySelectorAll: (selector: string) => buttons.filter(button =>
      (button.dataset.action && selector.includes(`[data-action="${button.dataset.action}"]`))),
  });
  fields.set('settings-section-storage', section);
  const document = {
    getElementById: (id: string) => fields.get(id) ?? null,
    querySelectorAll: (selector: string) => selector.endsWith('.storage-retention-input') ? retention
      : selector.endsWith('.storage-enabled-input') ? enabled : buttons,
  } as unknown as Document;
  const meta: StorageMeta = {
    auto_clean: true, interval_minutes: 15, orphan_grace_days: 2, active_grace_hours: 4,
    categories: [
      { key: 'workspace', label: 'Workspace <unsafe>', hint: 'Hint "quoted"', enabled: true, retention_days: 30, default_retention: 7 },
      { key: 'reduction', label: 'Cache', enabled: false, retention_days: 0 },
    ],
  };
  const status: StorageReport = {
    filesystem: { available: true, used_bytes: 9216, free_bytes: 1024, total_bytes: 10240, used_percent: 90, inodes_total: 100, inodes_free: 20 },
    totals: { bytes: 4096, units: 5, reclaimable_bytes: 2048, reclaimable_units: 2 },
    scanned_at: 'not-a-date',
    categories: [
      { key: 'workspace', root: '/srv/data/workspace', units: 5, bytes: 4096, reclaimable_bytes: 2048, reclaimable_units: 2, orphan_units: 1, skipped_active: 3 },
      { key: 'reduction', missing: true },
    ],
  };
  const report: StorageReport = {
    totals: { reclaimable_bytes: 2048, reclaimable_units: 2, freed_bytes: 1024, removed_units: 1, skipped_active: 3 },
    categories: [
      { key: 'workspace', label: 'Workspace', reclaimable_bytes: 2048, reclaimable_units: 2, freed_bytes: 1024, removed_units: 1, errors: ['<failure>', 'two', 'three', 'four'] },
      { key: 'reduction', label: 'Cache', errors: ['locked'] },
    ],
  };
  const api = vi.fn<ApiFetch>().mockImplementation(async url => Response.json(
    url.endsWith('/meta') ? meta : url.endsWith('/cleanup') ? report : status,
  ));
  const confirm = vi.fn(() => true), alert = vi.fn();
  const view = initStorage(document, api, { translate: key => key, confirm, alert });
  return { view, api, confirm, alert, field, fields, buttons, retention, enabled, meta, status };
}

describe('storage settings controller parity', () => {
  it('renders capacity, inodes, category hints, retention and missing/disabled categories safely', async () => {
    const { view, field } = fixture();
    await view.initStorageSection();
    expect(field('storage-overview').hidden).toBe(false);
    expect(field('storage-disk-used').textContent).toBe('9.0 KB');
    expect(field('storage-disk-detail').textContent).toBe('1.0 KB free / 10.0 KB');
    expect(field('storage-inodes').textContent).toBe('80 / 100 (80.0%)');
    expect(field('storage-scanned-at').textContent).toBe('Scanned at not-a-date');
    expect(field('storage-usage-bar-fill').style.width).toBe('90.0%');
    expect(field('storage-usage-bar-fill').classList.toggle).toHaveBeenCalledWith('storage-usage-bar-fill--warn', true);
    const rows = field('storage-category-rows').innerHTML;
    expect(rows).toContain('Workspace &lt;unsafe&gt;');
    expect(rows).toContain('Hint &quot;quoted&quot;');
    expect(rows).toContain('title="/srv/data/workspace">…/data/workspace');
    expect(rows).toContain('incl. orphans 1 · skipped active 3');
    expect(rows).toContain('Default 7 days');
    expect(rows).toContain('storage-row--disabled');
    expect(rows).toContain('Unused');
    expect(rows).toContain('data-key="reduction" value="0"');
    expect(rows).not.toMatch(/\son(?:click|change|input)=/);
  });

  it('handles unavailable capacity and an empty category registry', async () => {
    const { view, field, meta, status } = fixture();
    meta.categories = [];
    status.filesystem = { available: false };
    status.scanned_at = '';
    await view.initStorageSection();
    expect(field('storage-category-rows').innerHTML).toContain('No cleanable categories');
    expect(field('storage-disk-used').textContent).toBe('Unavailable');
    expect(field('storage-inodes').textContent).toBe('Unavailable');
    expect(field('storage-scanned-at').textContent).toBe('');
  });

  it('previews without confirmation, then confirms actual deletion and forces a status rescan', async () => {
    const { view, api, confirm, field } = fixture();
    await view.initStorageSection();
    api.mockClear();
    await view.previewStorageCleanup();
    expect(confirm).not.toHaveBeenCalled();
    expect(field('storage-result').innerHTML).toContain('Preview (nothing was deleted)');
    expect(field('storage-result').innerHTML).not.toContain('locked');
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/storage/cleanup']);
    await view.runStorageCleanup();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2.0 KB (2 items)'));
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/storage/cleanup', '/api/storage/cleanup', '/api/storage/status?refresh=1']);
    const result = field('storage-result').innerHTML;
    expect(result).toContain('Cleanup finished');
    expect(result).toContain('1.0 KB / 1 items');
    expect(result).toContain('&lt;failure&gt;<br>two<br>three');
    expect(result).not.toContain('four');
    expect(result).toContain('locked'); // Error-only categories are included after real cleanup.
    expect(result).toContain('Skipped sessions with recent activity: 3 items');
  });

  it('cancels deletion without a request or refresh', async () => {
    const { view, api, confirm } = fixture();
    confirm.mockReturnValue(false);
    await view.runStorageCleanup();
    expect(api).not.toHaveBeenCalled();
  });

  it('collects edited retention while keeping unrendered categories and defaulting invalid numeric fields', async () => {
    const { view, api, field, retention, enabled, alert } = fixture();
    await view.initStorageSection();
    field('storage-auto-clean').checked = false;
    field('storage-interval-minutes').value = '-1';
    field('storage-orphan-grace-days').value = '';
    field('storage-active-grace-hours').value = 'n/a';
    const days = new Field(); days.dataset.key = 'workspace'; days.value = '0'; retention.push(days);
    const toggle = new Field(); toggle.dataset.key = 'workspace'; toggle.checked = false; enabled.push(toggle);
    const unknown = new Field(); unknown.dataset.key = 'unknown'; unknown.value = '99'; retention.push(unknown);
    api.mockClear();
    await view.saveStorageSettings();
    expect(api.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ storage: {
      auto_clean: false, interval_minutes: 5, orphan_grace_days: 0, active_grace_hours: 1,
      categories: { workspace: { enabled: false, retention_days: 0 }, reduction: { enabled: false, retention_days: 0 } },
    } }));
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/config', '/api/storage/meta']);
    expect(alert).toHaveBeenCalledWith('Cleanup policy saved');
  });

  it('binds exactly the four declarative shell actions once and removes listeners on disposal', async () => {
    const { view, buttons, api } = fixture();
    view.bind();
    view.bind();
    expect(buttons.map(button => button.dataset.action)).toEqual(['storage.refresh', 'storage.preview', 'storage.cleanup', 'storage.save']);
    expect(buttons.every(button => !button.attributes.has('onclick'))).toBe(true);
    buttons[0]!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(buttons[0]!.disabled).toBe(false));
    expect(api.mock.calls.map(([url]) => url)).toEqual(['/api/storage/status?refresh=1']);
    view.dispose();
    buttons[1]!.dispatchEvent(new Event('click'));
    await view.previewStorageCleanup();
    expect(api).toHaveBeenCalledOnce();
  });

  it('displays escaped failures and restores buttons after a rejected request', async () => {
    const { view, api, field, buttons } = fixture();
    api.mockRejectedValueOnce(new Error('<offline>'));
    await view.previewStorageCleanup();
    expect(field('storage-result').className).toBe('storage-result storage-result--error');
    expect(field('storage-result').innerHTML).toContain('&lt;offline&gt;');
    expect(buttons.every(button => !button.disabled)).toBe(true);
    await view.previewStorageCleanup();
    expect(field('storage-result').className).toBe('storage-result');
  });
});
