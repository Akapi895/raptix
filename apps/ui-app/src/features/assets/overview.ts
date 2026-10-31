import { escapeHtml as e, type Translate } from './contracts';
import type { AssetStats, TrendPoint } from './model';

export function renderOverview(doc: Document, stats: AssetStats, t: Translate): void {
  const text = (id: string, value: string) => { const el = doc.getElementById(id); if (el) el.textContent = value; };
  for (const key of ['total', 'ips', 'domains', 'ports', 'recent'] as const) text('asset-stat-' + key, Number(stats[key] || 0).toLocaleString());
  const total = Number(stats.total || 0), recent = Number(stats.recent || 0), percent = total ? Math.min(100, Math.round(recent / total * 100)) : 0;
  const progress = doc.getElementById('asset-recent-progress'); if (progress) progress.style.width = percent + '%';
  text('asset-recent-rate', t('assets.recentShare', { percent }));
  const chart = (rootId: string, summaryId: string, data: TrendPoint[], series: { key: keyof Omit<TrendPoint, 'date'>; label: string; color: string; fill?: string }[]) => {
    const root = doc.getElementById(rootId); if (!root) return;
    const totals = series.map(item => data.reduce((sum, point) => sum + Number(point[item.key] || 0), 0));
    const summary = doc.getElementById(summaryId); if (summary) summary.innerHTML = series.map((item, i) => `<div><span>${e(item.label)}</span><strong style="color:${item.color}">${(totals[i] ?? 0).toLocaleString()}</strong></div>`).join('');
    if (!data.length) { root.innerHTML = `<div class="muted">${e(t('common.noData'))}</div>`; return; }
    const width = 680, height = 220, left = 34, right = 12, top = 18, bottom = 28, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = Math.max(1, ...data.flatMap(point => series.map(item => Number(point[item.key] || 0))));
    const x = (index: number) => left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth);
    const y = (value: number | undefined) => top + plotHeight - Number(value || 0) / max * plotHeight;
    const grid = [0, .25, .5, .75, 1].map(ratio => { const gy = top + plotHeight * ratio; return `<line x1="${left}" y1="${gy}" x2="${width - right}" y2="${gy}"/><text x="${left - 8}" y="${gy + 4}" text-anchor="end">${Math.round(max * (1 - ratio))}</text>`; }).join('');
    const paths = series.map(item => {
      const coords = data.map((point, i) => `${x(i).toFixed(1)},${y(point[item.key]).toFixed(1)}`);
      const line = `<polyline points="${coords.join(' ')}" fill="none" stroke="${item.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      return item.fill ? `<path d="M ${x(0).toFixed(1)} ${top + plotHeight} L ${coords.join(' L ')} L ${x(data.length - 1).toFixed(1)} ${top + plotHeight} Z" fill="${item.fill}"/>${line}` : line;
    }).join('');
    const labels = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].map(i => `<text x="${x(i)}" y="${height - 7}" text-anchor="${i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}">${e(data[i]?.date.slice(5))}</text>`).join('');
    root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(series.map((item, i) => `${item.label} ${totals[i]}`).join(', '))}" preserveAspectRatio="none"><g class="asset-chart-grid">${grid}${labels}</g>${paths}</svg>`;
  };
  chart('asset-growth-chart', 'asset-growth-summary', stats.asset_trend || [], [{ key: 'added', label: t('assets.addedAssets'), color: '#3b82f6', fill: 'rgba(59,130,246,.13)' }, { key: 'inactive', label: t('assets.inactiveAssets'), color: '#8b5cf6' }]);
  chart('asset-risk-chart', 'asset-risk-summary', stats.risk_trend || [], [{ key: 'discovered', label: t('assets.discoveredRisks'), color: '#f59e0b', fill: 'rgba(245,158,11,.12)' }, { key: 'high_risk', label: t('assets.highRisks'), color: '#ef4444' }]);
  const coverage = stats.coverage || {}, rate = Math.max(0, Math.min(100, Number(coverage.rate || 0))), recentRate = Math.max(0, Math.min(100, Number(coverage.recent_rate || 0)));
  const gauge = doc.getElementById('asset-coverage-gauge'), status = doc.getElementById('asset-coverage-status'), state = total > 0 ? rate >= 80 ? 'healthy' : rate >= 50 ? 'warning' : 'critical' : '';
  if (gauge) gauge.style.setProperty('--asset-coverage-value', rate + '%');
  for (const el of [gauge, status]) { el?.classList.remove('is-healthy', 'is-warning', 'is-critical'); if (state) el?.classList.add('is-' + state); }
  text('asset-coverage-rate', rate + '%'); text('asset-coverage-scanned', Number(coverage.scanned || 0).toLocaleString()); text('asset-coverage-recent', Number(coverage.scanned_30d || 0).toLocaleString());
  text('asset-coverage-recent-rate', t('assets.coverageOfTotal', { percent: recentRate })); text('asset-coverage-never', Number(coverage.never_scanned || 0).toLocaleString()); text('asset-coverage-stale', Number(coverage.stale || 0).toLocaleString());
  text('asset-coverage-status', total ? t('assets.coverageMeta', { scanned: coverage.scanned || 0, total }) : '—');
  for (const [id, count] of [['asset-coverage-never', coverage.never_scanned], ['asset-coverage-stale', coverage.stale]] as const) doc.getElementById(id)?.parentElement?.classList.toggle('has-gap', Number(count) > 0);
  const root = doc.getElementById('asset-protocol-chart'), items = stats.protocols || [];
  text('asset-protocol-meta', t('assets.protocolKinds', { count: items.length })); if (!root) return;
  if (!items.length) { root.innerHTML = `<div class="asset-protocol-empty"><span>—</span><p>${e(t('common.noData'))}</p></div>`; return; }
  const visible = items.slice(0, 5), max = Math.max(...visible.map(i => i.count), 1), protocolTotal = items.reduce((sum, i) => sum + i.count, 0), colors = ['#4f7df3', '#6d5df6', '#13b8a6', '#f59e0b', '#ec4899'];
  root.innerHTML = visible.map((item, i) => { const percent = (total || protocolTotal) ? item.count / (total || protocolTotal) * 100 : 0; return `<div class="asset-bar-row" style="--protocol-color:${colors[i]}"><span class="asset-bar-label">${e(item.name || 'unknown')}</span><div class="asset-bar-track"><i style="width:${Math.max(3, Math.round(item.count / max * 100))}%"></i></div><strong>${item.count.toLocaleString()}</strong><small>${percent > 0 && percent < 1 ? '&lt;1%' : Math.round(percent) + '%'}</small></div>`; }).join('');
}
