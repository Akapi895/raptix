import { errorMessage, escapeHtml as esc, storageText } from './text';
import { formatBytes as fmt, nonnegativeInt, type StorageService } from './service';
import type { CategoryReport, StorageCategory, StorageDependencies, StorageReport } from './types';

export function createStorageView(document: Document, service: StorageService, dependencies: StorageDependencies) {
  let disposed = false;
  const listeners = new Map<HTMLButtonElement, () => void>();
  const st = (key: string, fallback: string) => storageText(dependencies.translate, key, fallback);
  const el = (id: string) => document.getElementById(id);
  const input = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const text = (id: string, value: unknown) => { const target = el(id); if (target) target.textContent = String(value ?? ''); };
  const catLabel = (cat: { key: string; label?: string }) => st(`cat.${cat.key}`, cat.label || cat.key);
  const shortRoot = (root = '') => { const parts = root.split('/').filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : root; };
  function renderRows() {
    if (disposed) return;
    const target = el('storage-category-rows'); if (!target) return;
    const categories = service.meta?.categories ?? [];
    const byKey = new Map((service.status?.categories ?? []).map(c => [c.key, c]));
    if (!categories.length) { target.innerHTML = `<tr><td colspan="7" class="storage-empty">${esc(st('noCategories', 'No cleanable categories'))}</td></tr>`; return; }
    target.innerHTML = categories.map((m: StorageCategory) => {
      const s: CategoryReport = byKey.get(m.key) ?? { key: m.key };
      const reclaim = [`${s.reclaimable_units || 0} ${st('itemsUnit', 'items')}`];
      if (s.orphan_units) reclaim.push(`${st('orphanSuffix', 'incl. orphans')} ${s.orphan_units}`);
      if (s.skipped_active) reclaim.push(`${st('skippedActive', 'skipped active')} ${s.skipped_active}`);
      const title = `${st('defaultRetention', 'Default')} ${m.default_retention ?? '-'} ${st('daysUnit', 'days')}`;
      return `<tr class="${m.enabled ? '' : 'storage-row--disabled'}"><td><span class="storage-cat-label" title="${esc(st(`catHint.${m.key}`, m.hint || ''))}">${esc(catLabel(m))}</span></td><td>${s.missing ? `<span class="storage-muted">${esc(st('unused', 'Unused'))}</span>` : `<code class="storage-root" title="${esc(s.root)}">${esc(shortRoot(s.root))}</code>`}</td><td>${s.missing ? '—' : s.units || 0}</td><td>${s.missing ? '—' : fmt(s.bytes)}</td><td>${s.missing ? '—' : `<strong>${fmt(s.reclaimable_bytes)}</strong><span class="storage-sub">${esc(reclaim.join(' · '))}</span>`}</td><td><input type="number" class="storage-retention-input" min="0" step="1" data-key="${esc(m.key)}" value="${esc(m.retention_days ?? 0)}" title="${esc(title)}" aria-label="${esc(title)}"></td><td><input type="checkbox" class="storage-enabled-input" data-key="${esc(m.key)}" ${m.enabled ? 'checked' : ''} aria-label="${esc(catLabel(m))}"></td></tr>`;
    }).join('');
  }
  function renderPolicy() {
    if (disposed) return;
    if (!service.meta) return;
    const auto = input('storage-auto-clean'); if (auto) auto.checked = !!service.meta.auto_clean;
    for (const [id, value] of [['storage-interval-minutes', service.meta.interval_minutes], ['storage-orphan-grace-days', service.meta.orphan_grace_days], ['storage-active-grace-hours', service.meta.active_grace_hours]] as const) {
      const field = input(id); if (field) field.value = String(value ?? '');
    }
  }
  function render() {
    if (disposed) return;
    const overview = el('storage-overview'); if (overview) overview.hidden = false;
    const fs = service.status?.filesystem ?? {}, totals = service.status?.totals ?? {};
    text('storage-disk-used', fs.available ? fmt(fs.used_bytes) : st('unavailable', 'Unavailable'));
    const fill = el('storage-usage-bar-fill');
    if (fill) { const percent = fs.available ? Math.max(0, Math.min(100, Number(fs.used_percent) || 0)) : 0; fill.style.width = `${percent.toFixed(1)}%`; fill.classList.toggle('storage-usage-bar-fill--warn', percent >= 85); }
    text('storage-disk-detail', fs.available ? `${fmt(fs.free_bytes)} ${st('free', 'free')} / ${fmt(fs.total_bytes)}` : '');
    text('storage-total-bytes', fmt(totals.bytes)); text('storage-total-units', `${totals.units || 0} ${st('itemsUnit', 'items')}`);
    text('storage-reclaimable-bytes', fmt(totals.reclaimable_bytes)); text('storage-reclaimable-units', `${totals.reclaimable_units || 0} ${st('itemsUnit', 'items')}`);
    const inodeTotal = fs.inodes_total ?? 0, used = Math.max(0, inodeTotal - (fs.inodes_free ?? 0));
    text('storage-inodes', fs.available && inodeTotal > 0 ? `${used.toLocaleString()} / ${inodeTotal.toLocaleString()} (${(used / inodeTotal * 100).toFixed(1)}%)` : st('unavailable', 'Unavailable'));
    const scanned = service.status?.scanned_at; const date = scanned ? new Date(scanned) : null;
    text('storage-scanned-at', scanned && date ? `${st('scannedAt', 'Scanned at')} ${isNaN(date.getTime()) ? scanned : date.toLocaleString()}` : '');
    renderRows(); renderPolicy();
  }
  function renderResult(report: StorageReport, preview: boolean) {
    if (disposed) return;
    const target = el('storage-result'); if (!target) return;
    const totals = report.totals ?? {};
    const summary = (c: CategoryReport | typeof totals) => `${fmt(preview ? c.reclaimable_bytes : c.freed_bytes)} / ${(preview ? c.reclaimable_units : c.removed_units) || 0} ${st('itemsUnit', 'items')}`;
    const rows = (report.categories ?? []).filter(c => preview ? (c.reclaimable_units ?? 0) > 0 : (c.removed_units ?? 0) > 0 || !!c.errors?.length).map(c => `<li><span>${esc(catLabel(c))}</span><span>${esc(summary(c))}${c.errors?.length ? `<br><span class="storage-error-text">${c.errors.slice(0, 3).map(esc).join('<br>')}</span>` : ''}</span></li>`);
    target.className = 'storage-result';
    target.innerHTML = `<div class="storage-result-head"><strong>${esc(preview ? st('previewTitle', 'Preview (nothing was deleted)') : st('cleanDone', 'Cleanup finished'))}</strong><span>${esc(summary(totals))}</span></div>${rows.length ? `<ul class="storage-result-list">${rows.join('')}</ul>` : `<p class="storage-muted">${esc(st('nothingToClean', 'Nothing currently matches the cleanup policy.'))}</p>`}${totals.skipped_active ? `<p class="storage-muted">${esc(st('skippedActiveNote', 'Skipped sessions with recent activity: ') + totals.skipped_active + ' ' + st('itemsUnit', 'items'))}</p>` : ''}`;
    target.hidden = false;
  }
  async function withBusy(action: () => Promise<void>) {
    if (disposed) return;
    await service.exclusive(async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>('#settings-section-storage button');
      buttons.forEach(b => { b.disabled = true; });
      try { await action(); } catch (error) {
        const target = el('storage-result'); if (target && !disposed) { target.className = 'storage-result storage-result--error'; target.innerHTML = `<div class="storage-result-head"><strong>${esc(st('failed', 'Operation failed'))}</strong><span>${esc(errorMessage(error))}</span></div>`; target.hidden = false; }
      } finally { buttons.forEach(b => { b.disabled = false; }); }
    });
  }
  const view = {
    initStorageSection: () => el('storage-category-rows') ? withBusy(async () => { await service.loadMeta(); await service.loadStatus(); render(); }) : Promise.resolve(),
    refreshStorageStatus: (force = false) => withBusy(async () => { await service.loadStatus(force === true); render(); }),
    previewStorageCleanup: () => withBusy(async () => renderResult(await service.cleanup(true), true)),
    async runStorageCleanup() {
      if (disposed || service.busy) return;
      const totals = service.status?.totals ?? {};
      const message = st('confirmClean', 'This permanently deletes about {size} ({count} items) of runtime files and cannot be undone. Run "Preview reclaimable" first. Continue?').replace('{size}', fmt(totals.reclaimable_bytes)).replace('{count}', String(totals.reclaimable_units || 0));
      if (dependencies.confirm(message)) await withBusy(async () => { renderResult(await service.cleanup(false), false); await service.loadStatus(true); render(); });
    },
    saveStorageSettings: () => withBusy(async () => {
      const policy = service.policyBase(); policy.auto_clean = !!input('storage-auto-clean')?.checked;
      policy.interval_minutes = nonnegativeInt(input('storage-interval-minutes')?.value, 5);
      policy.orphan_grace_days = nonnegativeInt(input('storage-orphan-grace-days')?.value, 0);
      policy.active_grace_hours = nonnegativeInt(input('storage-active-grace-hours')?.value, 1);
      document.querySelectorAll<HTMLInputElement>('#storage-category-rows .storage-retention-input').forEach(field => { const item = policy.categories[field.dataset.key ?? '']; if (item) item.retention_days = nonnegativeInt(field.value, 0); });
      document.querySelectorAll<HTMLInputElement>('#storage-category-rows .storage-enabled-input').forEach(field => { const item = policy.categories[field.dataset.key ?? '']; if (item) item.enabled = field.checked; });
      await service.save(policy); renderPolicy(); renderRows(); if (!disposed) dependencies.alert(st('saved', 'Cleanup policy saved'));
    }),
    bind(): void {
      if (disposed) return;
      const section = el('settings-section-storage');
      if (!section) return;
      const actions = [
        ['storage.refresh', () => view.refreshStorageStatus(true)],
        ['storage.preview', view.previewStorageCleanup],
        ['storage.cleanup', view.runStorageCleanup],
        ['storage.save', view.saveStorageSettings],
      ] as const;
      for (const [action, handler] of actions) {
        section.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`).forEach(button => {
          if (listeners.has(button)) return;
          const listener = () => { if (!button.disabled) void handler(); };
          button.addEventListener('click', listener);
          listeners.set(button, listener);
        });
      }
    },
    dispose(): void {
      disposed = true;
      listeners.forEach((listener, button) => button.removeEventListener('click', listener));
      listeners.clear();
    },
  };
  return view;
}
