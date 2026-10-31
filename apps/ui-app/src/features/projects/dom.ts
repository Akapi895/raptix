import type { Translate } from './types';

export const esc = (value: unknown): string => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function createProjectsDom(document: Document, translate: Translate) {
  const el = (id: string) => document.getElementById(id);
  const field = (id: string) => { const node = el(id); return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement ? node : null; };
  const text = (id: string, value: string) => { const node = el(id); if (node) node.textContent = value; };
  const value = (id: string) => field(id)?.value ?? '';
  const setValue = (id: string, value: string) => { const node = field(id); if (node) node.value = value; };
  const checked = (id: string) => { const node = el(id); return node instanceof HTMLInputElement && node.checked; };
  const setChecked = (id: string, checked: boolean) => { const node = el(id); if (node instanceof HTMLInputElement) node.checked = checked; };
  const hidden = (id: string, hidden: boolean) => { const node = el(id); if (node) node.hidden = hidden; };
  const html = (id: string, html: string) => { const node = el(id); if (node) node.innerHTML = html; };
  const t = translate;
  const fmt = (key: string, fallback: string, options?: Record<string, unknown>) => { const result = t(key, options); return result && result !== key ? result : fallback; };
  return { document, el, field, text, value, setValue, checked, setChecked, hidden, html, t, fmt,
    empty: (id: string, columns: number, key: string) => html(id, `<tr class="is-empty-row"><td colspan="${columns}">${esc(t(key))}</td></tr>`),
    button: (action: string, label: string, data = '', modifier = 'view', title = '') => `<button type="button" class="projects-action-btn projects-action-btn--${esc(modifier)}" data-action="projects.${action}" ${data} title="${esc(title)}">${esc(label)}</button>`,
  };
}
export type ProjectsDom = ReturnType<typeof createProjectsDom>;
export function parseProjectDate(value: string | number | null | undefined): Date | null {
  if (value == null || value === '' || String(value).startsWith('0001-01-01')) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 2000) return date;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz]|([+-])(\d{2}):?(\d{2}))?)?$/);
  if (!m) return null;
  const offset = (Number(m[10] || 0) * 60 + Number(m[11] || 0)) * (m[9] === '-' ? -1 : 1);
  const parsed = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number((m[7] || '').slice(0, 3).padEnd(3, '0'))) - offset * 60000);
  return parsed.getFullYear() >= 2000 ? parsed : null;
}
export function formatProjectTime(t: Translate, value?: string | number | null, fallback?: string | number | null): string {
  const date = parseProjectDate(value) ?? parseProjectDate(fallback);
  if (!date) return t('projects.notUpdatedYet');
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return t('common.justNow');
  for (const [limit, unit, key] of [[3600000, 60000, 'minutesAgo'], [86400000, 3600000, 'hoursAgo'], [604800000, 86400000, 'daysAgo']] as const) if (diff < limit) return t(`common.${key}`, { n: Math.floor(diff / unit) });
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
