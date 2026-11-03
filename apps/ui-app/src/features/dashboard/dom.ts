import type { DashboardDependencies } from './types';

export function createDashboardDom(document: Document, dependencies: DashboardDependencies) {
  const el = (id: string): HTMLElement | null => document.getElementById(id);
  const text = (id: string, value: string): void => { const node = el(id); if (node) node.textContent = value; };
  const hidden = (id: string, value: boolean): void => { const node = el(id); if (node) node.hidden = value; };
  const t = (key: string, options: Record<string, string | number> | null = null, fallback = key): string => {
    const value = dependencies.translate(key, options ?? undefined);
    return value && value !== key ? value : fallback;
  };
  const sub = (id: string, value: string, kind?: string): void => {
    const node = el(id);
    if (!node) return;
    node.textContent = value;
    node.classList.remove('is-pending', 'is-running', 'is-idle', 'is-warning', 'is-success', 'is-danger');
    if (kind) node.classList.add(`is-${kind}`);
  };
  const progress = (id: string, percentage: number): void => { const node = el(id); if (node) node.style.width = `${Math.max(0, Math.min(100, percentage || 0))}%`; };
  const severityLabel = (id: string): string => t(`dashboard.severity${id.charAt(0).toUpperCase()}${id.slice(1)}`, null,
    ({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' } as Record<string, string>)[id] ?? id);
  const statusKey = (status: string): string => {
    const s = status.toLowerCase();
    if (['fixed', 'closed', 'resolved'].includes(s)) return 'fixed';
    if (s === 'confirmed' || s === 'ignored') return s;
    if (['false_positive', 'false-positive', 'fp'].includes(s)) return 'fp';
    return 'open';
  };
  const statusLabel = (status: string): string => {
    const key = statusKey(status);
    const labels: Record<string, [string, string]> = {
      fixed: ['statusFixed', 'Fixed'], confirmed: ['statusConfirmed', 'Confirmed'], fp: ['statusFalsePositive', 'False positive'],
      ignored: ['statusIgnored', 'Ignored'], open: ['statusOpen', 'Open'],
    };
    const [translation, fallback] = labels[key] ?? ['statusOpen', 'Open'];
    return t(`dashboard.${translation}`, null, fallback);
  };
  const timeAgo = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (seconds < 60) return t('common.justNow', null, 'Just now');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('common.minutesAgo', { n: minutes }, `${minutes} min ago`);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('common.hoursAgo', { n: hours }, `${hours} h ago`);
    const days = Math.floor(hours / 24);
    if (days < 7) return t('common.daysAgo', { n: days }, `${days} d ago`);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return { document, dependencies, el, text, hidden, t, sub, progress, severityLabel, statusKey, statusLabel, timeAgo };
}
export type DashboardDom = ReturnType<typeof createDashboardDom>;
export const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const formatNumber = (value: number): string => Number.isFinite(value) ? value.toLocaleString('en-US') : '-';
export function formatTokenUsageCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(Math.trunc(n));
}
export function navigateAction(node: HTMLElement, page: string): void { node.dataset.action = 'navigate'; node.dataset.page = page; }
