import { formatTokenUsageCompact } from '../dashboard/index';
import { tokenUsageCacheRate, tokenUsageCount, tokenUsageMetrics, tokenUsageTimeline, type TokenUsageObserver, type TokenUsageService, type TokenUsageState } from './service';
import type { TokenUsageBreakdown, TokenUsageDependencies, TokenUsageSummary, TrendMetric } from './types';

type Cell = string | number | HTMLElement | undefined;
export function createTokenUsageView(document: Document, dependencies: TokenUsageDependencies) {
  const events = new AbortController();
  let renderEvents = new AbortController();
  let service: TokenUsageService, mounted = false, disposed = false;
  const text = (key: string, options: Record<string, string | number> | null = null, fallback = key): string => {
    const value = dependencies.translate(key, options ?? undefined); return value && value !== key ? value : fallback;
  };
  const label = (key: string) => text('dashboard.' + key, null, key);
  const ui = (key: string) => text('tokenUsageUI.' + key, null, key);
  const exact = (value: unknown) => tokenUsageCount(value).toLocaleString(dependencies.getLocale());
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag); if (className) element.className = className; if (value != null) element.textContent = value; return element;
  }
  function render(state: Readonly<TokenUsageState>): void {
    if (disposed) return;
    const host = document.getElementById('settings-token-analysis'); if (!host) return;
    renderEvents.abort(); renderEvents = new AbortController();
    host.replaceChildren();
    const res = state.result;
    if (!res?.summary) { host.append(node('div', 'token-usage-empty', label('usageUnavailable'))); return; }
    const summary = res.summary, metrics = new Map(tokenUsageMetrics(summary));
    const primary = node('div', 'token-usage-metrics token-usage-primary'), secondary = node('div', 'token-usage-metrics token-usage-secondary');
    const primaryKeys = ['usageTotal', 'usageInput', 'usageOutput', 'usageCacheRate'];
    for (const key of [...primaryKeys, 'usageCalls', 'usageCacheRead', 'usageCacheWrite', 'usageReasoning']) {
      const value = metrics.get(key), card = node('div', 'token-usage-metric'); card.dataset.metric = key;
      card.append(node('span', '', label(key)), node('strong', '', typeof value === 'string' ? value : exact(value)));
      (primaryKeys.includes(key) ? primary : secondary).append(card);
    }
    host.append(primary, secondary);
    if (!tokenUsageCount(summary.events)) { host.append(node('div', 'token-usage-empty', label('noTokenUsageYet'))); return; }
    const chartLayout = node('div', 'token-usage-charts'), chart = node('section', 'token-usage-chart-card'), chartHead = node('div', 'token-usage-chart-head');
    chartHead.append(node('h4', '', label('usageTrend')));
    const tabs = node('div', 'token-usage-chart-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', ui('trendMetric'));
    const trendTabs: [TrendMetric, string][] = [['totalTokens', 'usageTotal'], ['modelCalls', 'usageCalls'], ['cacheRate', 'usageCacheRate']];
    for (const [metric, key] of trendTabs) {
      const button = node('button', '', label(key)); button.type = 'button'; button.dataset.tokenTrend = metric; button.dataset.action = 'token-usage.trend'; button.setAttribute('aria-pressed', String(state.trendMetric === metric)); tabs.append(button);
    }
    chartHead.append(tabs); chart.append(chartHead);
    const tooltip = node('p', 'token-usage-chart-tooltip', ui('chartHint')); tooltip.setAttribute('aria-live', 'polite');
    const days = tokenUsageTimeline(res.byDay), metric = state.trendMetric;
    const valueOf = (row: TokenUsageBreakdown): number => metric === 'cacheRate' ? (tokenUsageCount(row.promptTokens) ? Math.min(tokenUsageCount(row.cachedTokens), tokenUsageCount(row.promptTokens)) / tokenUsageCount(row.promptTokens) * 100 : 0) : tokenUsageCount(row[metric]);
    const peak = metric === 'cacheRate' ? 100 : Math.max(1, ...days.map(valueOf));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 640 230'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', label('usageTrend')); svg.classList.add('token-usage-trend-svg');
    function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, value?: string): SVGElementTagNameMap[K] {
      const element = document.createElementNS(svgNS, tag); Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value))); if (value != null) element.textContent = value; return element;
    }
    for (let tick = 0; tick <= 4; tick++) {
      const y = 18 + tick * 44;
      svg.append(svgElement('line', { x1: 54, x2: 624, y1: y, y2: y, class: 'token-usage-chart-grid' }));
      svg.append(svgElement('text', { x: 46, y: y + 4, 'text-anchor': 'end', class: 'token-usage-chart-label' }, metric === 'cacheRate' ? (100 - tick * 25) + '%' : formatTokenUsageCompact(peak * (4 - tick) / 4)));
    }
    const slot = 570 / Math.max(days.length, 1), every = Math.max(1, Math.ceil(days.length / 7));
    days.forEach((row, index) => {
      const x = 54 + slot * (index + .5), height = valueOf(row) / peak * 176;
      const detail = `${row.key} · ${label('usageTotal')} ${exact(row.totalTokens)} · ${label('usageCalls')} ${exact(row.modelCalls)} · ${label('usageCacheRate')} ${tokenUsageCacheRate(row)}`;
      const bar = svgElement('rect', { x: x - Math.min(24, slot * .55) / 2, y: 194 - height, width: Math.min(24, slot * .55), height: Math.max(height, 1), rx: 3, class: 'token-usage-chart-bar', tabindex: 0, 'aria-label': detail });
      bar.append(svgElement('title', {}, detail));
      for (const event of ['mouseenter', 'focus']) bar.addEventListener(event, () => { tooltip.textContent = detail; }, { signal: renderEvents.signal });
      for (const event of ['mouseleave', 'blur']) bar.addEventListener(event, () => { tooltip.textContent = ui('chartHint'); }, { signal: renderEvents.signal });
      svg.append(bar);
      if (index % every === 0 || index === days.length - 1) svg.append(svgElement('text', { x, y: 218, 'text-anchor': 'middle', class: 'token-usage-chart-label' }, row.key.slice(5)));
    });
    const plot = node('div', 'token-usage-svg-wrap'); plot.append(svg); chart.append(plot, tooltip);
    if (!days.length) chart.append(node('p', 'token-usage-empty', ui('noDailyData')));
    chartLayout.append(chart);
    const cache = node('section', 'token-usage-chart-card token-usage-cache-card'); cache.append(node('h4', '', ui('cacheComposition')));
    const input = tokenUsageCount(summary.promptTokens), cached = Math.min(input, tokenUsageCount(summary.cachedTokens)), ratio = input ? cached / input * 100 : 0;
    const ring = node('div', 'token-usage-cache-ring'); ring.style.setProperty('--cache-ratio', ratio + '%'); ring.append(node('strong', '', tokenUsageCacheRate(summary)), node('span', '', ui('cacheHit'))); cache.append(ring);
    const legend: [string, number, string][] = [['usageCacheRead', cached, 'is-cached'], ['uncachedInput', input - cached, 'is-uncached']];
    for (const [key, value, className] of legend) {
      const line = node('div', 'token-usage-cache-legend ' + className); line.append(node('span', '', key === 'uncachedInput' ? ui(key) : label(key)), node('strong', '', exact(value))); cache.append(line);
    }
    cache.append(node('p', 'token-usage-chart-note', ui('cacheNote'))); chartLayout.append(cache); host.append(chartLayout);
    // Provider labels remain text; every count in tables retains full precision.
    function table(titleKey: string, headings: string[], rows: Cell[][], collapsed = false): void {
      const section = node(collapsed ? 'details' : 'section', 'token-usage-data-card'), title = node(collapsed ? 'summary' : 'h4', '', label(titleKey));
      const wrap = node('div', 'token-usage-table-wrap'), grid = node('table'), caption = node('caption', 'sr-only', label(titleKey)), head = node('thead'), hr = node('tr');
      headings.forEach(key => { const th = node('th', '', label(key)); th.scope = 'col'; hr.append(th); }); head.append(hr);
      const body = node('tbody');
      rows.forEach(values => {
        const tr = node('tr'); values.forEach(value => { const td = node('td'); if (value instanceof HTMLElement) td.append(value); else td.textContent = value == null ? '' : String(value); tr.append(td); }); body.append(tr);
      });
      grid.append(caption, head, body); wrap.append(grid); section.append(title, wrap); host?.append(section);
    }
    const counts = (row: TokenUsageSummary): string[] => [exact(row.promptTokens), exact(row.completionTokens), exact(row.cachedTokens), exact(row.cacheWriteTokens), exact(row.reasoningTokens), exact(row.totalTokens), exact(row.modelCalls)];
    const fields = ['usageInput', 'usageOutput', 'usageCacheRead', 'usageCacheWrite', 'usageReasoning', 'usageTotal', 'usageCalls'];
    table('usageByModel', ['usageModel', 'usageShare', ...fields], (res.byModel || []).map(row => {
      const ratio = tokenUsageCount(summary.totalTokens) ? tokenUsageCount(row.totalTokens) / tokenUsageCount(summary.totalTokens) * 100 : 0;
      const share = node('div', 'token-usage-share'); share.append(node('span', '', ratio.toFixed(1) + '%'));
      const track = node('span', 'token-usage-share-track'), fill = node('span'); fill.style.width = Math.min(100, ratio) + '%'; track.append(fill); share.append(track);
      return [row.label || row.key, share, ...counts(row)];
    }));
    table('usageByDay', ['usageDate', ...fields], (res.byDay || []).map(row => [row.key, ...counts(row)]), true);
    table('usageRecent', ['usageTime', 'usageModel', 'usageStatus', 'usageTotal', 'usageCalls'], (res.recent || []).map(row => {
      const time = new Date(row.createdAt), status = node('span', 'token-usage-status', row.reason === 'final' ? label('usageFinal') : row.reason === 'partial' ? label('usagePartial') : row.reason || '—');
      if (row.reason === 'final' || row.reason === 'partial') status.classList.add('is-' + row.reason);
      return [Number.isFinite(time.getTime()) ? time.toLocaleString(dependencies.getLocale()) : '—', row.model || '—', status, exact(row.totalTokens), exact(row.modelCalls)];
    }));
  }
  function open(): void {
    if (dependencies.hash() === '#settings?section=token-usage') { dependencies.navigate('settings'); dependencies.settingsSection('token-usage'); }
    else dependencies.setHash('settings?section=token-usage');
  }
  function setTrend(metric: string): void {
    if (!['totalTokens', 'modelCalls', 'cacheRate'].includes(metric)) return;
    service.setTrend(metric); document.querySelector<HTMLElement>(`[data-token-trend="${service.snapshot().trendMetric}"]`)?.focus();
  }
  const observer: TokenUsageObserver = {
    loading(days, projectId): void {
      const host = document.getElementById('settings-token-analysis'); if (!host) return;
      host.setAttribute('aria-busy', 'true'); host.textContent = text('common.loading', null, 'Loading…');
      const select = document.querySelector<HTMLSelectElement>('#settings-token-days'); if (select) select.value = String(days);
      const scope = document.getElementById('settings-token-scope'); if (scope) scope.textContent = text('tokenUsageUI.' + (projectId ? 'scopeProject' : 'scopeAccessible'), null, projectId ? 'Current project' : 'Accessible conversations');
    }, render,
    settled(): void { document.getElementById('settings-token-analysis')?.removeAttribute('aria-busy'); },
  };
  function mount(): void {
    if (mounted || disposed) return; mounted = true;
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
      if (target instanceof HTMLButtonElement && target.disabled) return;
      switch (target?.dataset.action) {
        case 'token-usage.refresh': if (document.getElementById('settings-token-analysis')) void service.refresh(); break;
        case 'token-usage.open': open(); break;
        case 'token-usage.trend': setTrend(target.dataset.tokenTrend || ''); break;
      }
    }, { signal: events.signal });
    document.addEventListener('change', event => { if (event.target instanceof HTMLSelectElement && event.target.id === 'settings-token-days') void service.changePeriod(event.target.value); }, { signal: events.signal });
    document.addEventListener('keydown', event => {
      if (event.target instanceof Element && event.target.closest('[data-action="token-usage.open"]') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); }
    }, { signal: events.signal });
    document.addEventListener('languagechange', () => {
      if (!service.snapshot().loading && document.getElementById('page-settings')?.classList.contains('active') && document.getElementById('settings-section-token-usage')?.classList.contains('active')) render(service.snapshot());
    }, { signal: events.signal });
  }
  return { observer, bind(value: TokenUsageService): void { service = value; }, mount, render, open, setTrend, dispose(): void { disposed = true; events.abort(); renderEvents.abort(); } };
}
