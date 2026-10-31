import { dashboardBrowser as browser } from '../../platform/dashboard-browser';
import { esc, type DashboardDom } from './dom';
import { severities, type Counts, type ToolStats } from './types';

const BAR_COLORS = [
  '#93c5fd', '#a78bfa', '#6ee7b7', '#fde047', '#fda4af', '#7dd3fc', '#a5b4fc', '#5eead4', '#fdba74', '#e9d5ff',
  '#67e8f9', '#c4b5fd', '#86efac', '#fcd34d', '#f9a8d4', '#bae6fd', '#c7d2fe', '#99f6e4', '#fed7aa', '#ddd6fe',
  '#22d3ee', '#8b5cf6', '#4ade80', '#fbbf24', '#fb7185', '#38bdf8', '#818cf8', '#2dd4bf', '#fb923c', '#e0e7ff',
];
const GRADIENTS: Record<string, readonly [string, string, string]> = {
  critical: ['#fecaca', '#f87171', '#dc2626'], high: ['#fed7aa', '#fb923c', '#ea580c'],
  medium: ['#fef08a', '#facc15', '#ca8a04'], low: ['#99f6e4', '#2dd4bf', '#0f766e'], info: ['#bfdbfe', '#60a5fa', '#2563eb'],
};
const CFG = { cx: 240, cy: 215, rOuter: 165, rInner: 115, labelOffset: 14, gapRad: 0.022 };
function halfRingPath(cx: number, cy: number, outer: number, inner: number): string {
  return `M ${cx - outer} ${cy} A ${outer} ${outer} 0 0 1 ${cx + outer} ${cy} L ${cx + inner} ${cy} A ${inner} ${inner} 0 0 0 ${cx - inner} ${cy} Z`;
}
function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (radius: number, angle: number): string => `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy - radius * Math.sin(angle)).toFixed(2)}`;
  const large = start - end > Math.PI ? 1 : 0;
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}

export function createDashboardCharts(dom: DashboardDom, navigateSeverity: (severity: string) => void) {
  const { document, el, text, t, severityLabel } = dom;
  const listeners = new AbortController();
  let bySeverity: Counts = {};
  let total = 0;
  let hoverId: string | null = null;
  let displayedTotal: number | null = null;
  let countFrame = 0;
  let readyFrame = 0;
  let tooltipFrame = 0;
  let hoverTimer: number | undefined;
  let tooltipTimer: number | undefined;
  let barTimer: number | undefined;
  let bound = false;
  let barsBound = false;
  let tooltip: HTMLDivElement | null = null;
  let barTooltip: HTMLDivElement | null = null;

  const closest = (target: EventTarget | null, selector: string): Element | null => target instanceof Element ? target.closest(selector) : null;
  function makeTooltip(className: string): HTMLDivElement {
    const node = document.createElement('div'); node.className = className; node.setAttribute('role', 'tooltip'); document.body.appendChild(node); return node;
  }
  function hideTooltip(): void { browser.cancelLater(tooltipTimer); tooltipTimer = undefined; if (tooltip) tooltip.style.display = 'none'; }
  function tooltipText(id: string): string {
    const count = bySeverity[id] ?? 0;
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    return `${severityLabel(id)} · ${count} (${pct}%) — ${t('dashboard.severityClickHint', null, 'Click to view')}`;
  }
  function showTooltip(event: MouseEvent, id: string): void {
    const node = tooltip ??= makeTooltip('dashboard-severity-donut-tooltip');
    browser.cancelLater(tooltipTimer);
    tooltipTimer = browser.later(() => {
      node.textContent = tooltipText(id); node.style.display = 'block';
      tooltipFrame = browser.frame(() => {
        const rect = node.getBoundingClientRect();
        let top = event.clientY - rect.height - 12;
        if (top < 8) top = event.clientY + 16;
        const left = Math.max(8, Math.min(event.clientX - rect.width / 2, browser.viewportWidth() - rect.width - 8));
        node.style.left = `${left}px`; node.style.top = `${top}px`;
      });
    }, 120);
  }
  function clearHighlight(): void {
    el('dashboard-vuln-bars')?.querySelectorAll('.is-active').forEach(node => node.classList.remove('is-active'));
    el('dashboard-severity-donut')?.querySelectorAll('.is-active, .is-dimmed').forEach(node => node.classList.remove('is-active', 'is-dimmed'));
  }
  function resetCenter(skipTotal = false): void {
    if (!skipTotal) { text('dashboard-severity-total', String(total)); displayedTotal = total; }
    const label = el('dashboard-severity-center-label');
    if (label) { label.textContent = t('dashboard.totalVulns', null, 'Total vulnerabilities'); label.classList.remove('is-severity'); label.removeAttribute('data-severity'); }
    el('dashboard-severity-center')?.classList.remove('is-hovering');
  }
  function setHover(id: string | null): void {
    browser.cancelFrame(countFrame);
    hoverId = id;
    const svg = el('dashboard-severity-donut');
    const chart = document.querySelector('.dashboard-severity-chart');
    if (!id) {
      svg?.classList.remove('is-highlighting'); svg?.removeAttribute('data-hover-severity');
      chart?.removeAttribute('data-hover-severity'); clearHighlight(); resetCenter(); return;
    }
    svg?.classList.add('is-highlighting'); svg?.setAttribute('data-hover-severity', id);
    svg?.querySelectorAll('.donut-segment[data-severity], .donut-segment-gloss[data-severity], .donut-leader[data-severity], .donut-label-text[data-severity]').forEach(node => {
      const match = node.getAttribute('data-severity') === id; node.classList.toggle('is-active', match); node.classList.toggle('is-dimmed', !match);
    });
    el('dashboard-vuln-bars')?.querySelectorAll('.dashboard-severity-legend-item').forEach(node => node.classList.toggle('is-active', node.getAttribute('data-severity') === id));
    text('dashboard-severity-total', String(bySeverity[id] ?? 0));
    const label = el('dashboard-severity-center-label');
    if (label) { label.textContent = severityLabel(id); label.classList.add('is-severity'); label.setAttribute('data-severity', id); }
    el('dashboard-severity-center')?.classList.add('is-hovering'); chart?.setAttribute('data-hover-severity', id);
  }
  function scheduleClear(): void {
    browser.cancelLater(hoverTimer);
    hoverTimer = browser.later(() => { hoverTimer = undefined; setHover(null); hideTooltip(); }, 60);
  }
  function bindDonut(): void {
    if (bound) return;
    const hits = el('dashboard-severity-donut-hits');
    if (!hits) return;
    bound = true;
    const selector = '.donut-segment-hit, .dashboard-severity-legend-item[data-severity]';
    for (const root of [hits, el('dashboard-vuln-bars')]) {
      if (!root) continue;
      root.addEventListener('mouseover', event => {
        const target = closest(event.target, selector); const id = target?.getAttribute('data-severity'); if (!id) return;
        browser.cancelLater(hoverTimer); hoverTimer = undefined;
        if (target?.classList.contains('donut-segment-hit') && hoverId === id) return;
        setHover(id); showTooltip(event, id);
      }, { signal: listeners.signal });
      root.addEventListener('mouseout', event => {
        const item = closest(event.target, selector);
        const related = closest(event.relatedTarget, selector);
        if (item === related || (root === hits && related)) return;
        if (root === hits && event.relatedTarget instanceof Node && hits.contains(event.relatedTarget)) return;
        scheduleClear();
      }, { signal: listeners.signal });
      root.addEventListener('click', event => {
        const id = closest(event.target, selector)?.getAttribute('data-severity');
        if (id) { event.preventDefault(); navigateSeverity(id); }
      }, { signal: listeners.signal });
      root.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const id = closest(event.target, selector)?.getAttribute('data-severity');
        if (id) { event.preventDefault(); navigateSeverity(id); }
      }, { signal: listeners.signal });
    }
  }
  function defs(): void {
    const node = el('dashboard-severity-donut-defs'); if (!node) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    node.innerHTML = '<linearGradient id="donut-track-face" x1="0%" y1="0%" x2="0%" y2="100%">' +
      `<stop offset="0%" stop-color="${dark ? '#334155' : '#f8fafc'}"/><stop offset="55%" stop-color="${dark ? '#1e293b' : '#e8eef5'}"/><stop offset="100%" stop-color="${dark ? '#172033' : '#dce5ef'}"/></linearGradient>` +
      '<radialGradient id="donut-track-vignette" cx="50%" cy="85%" r="75%" fx="50%" fy="85%">' +
      `<stop offset="0%" stop-color="${dark ? '#0f172a' : '#ffffff'}" stop-opacity="${dark ? '0.55' : '0.35'}"/><stop offset="70%" stop-color="${dark ? '#0f172a' : '#ffffff'}" stop-opacity="0"/></radialGradient>` +
      '<radialGradient id="donut-inner-gloss" cx="35%" cy="75%" r="55%">' +
      `<stop offset="0%" stop-color="${dark ? '#94a3b8' : '#ffffff'}" stop-opacity="${dark ? '0.10' : '0.45'}"/><stop offset="55%" stop-color="${dark ? '#94a3b8' : '#ffffff'}" stop-opacity="${dark ? '0.03' : '0.08'}"/><stop offset="100%" stop-color="${dark ? '#94a3b8' : '#ffffff'}" stop-opacity="0"/></radialGradient>` +
      '<filter id="donut-segment-soften" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="blur"/><feOffset dx="0" dy="1.5" in="blur" result="off"/>' +
      `<feFlood flood-color="${dark ? '#000000' : '#0f172a'}" flood-opacity="${dark ? '0.28' : '0.13'}" result="flood"/><feComposite in="flood" in2="off" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
      Object.entries(GRADIENTS).map(([id, stops]) => `<linearGradient id="donut-grad-${id}" x1="18%" y1="12%" x2="88%" y2="94%"><stop offset="0%" stop-color="${stops[0]}"/><stop offset="52%" stop-color="${stops[1]}"/><stop offset="100%" stop-color="${stops[2]}"/></linearGradient>`).join('');
  }
  function countUp(target: number): void {
    browser.cancelFrame(countFrame);
    const node = el('dashboard-severity-total'); if (!node || hoverId) return;
    if (browser.reducedMotion()) { node.textContent = String(target); displayedTotal = target; return; }
    const from = displayedTotal ?? 0;
    if (from === target) { node.textContent = String(target); displayedTotal = target; return; }
    let start: number | null = null;
    const duration = Math.min(520, 180 + Math.abs(target - from) * 28);
    const tick = (now: number): void => {
      start ??= now;
      const fraction = Math.min(1, (now - start) / duration);
      node.textContent = String(Math.round(from + (target - from) * (1 - Math.pow(1 - fraction, 3))));
      if (fraction < 1) countFrame = browser.frame(tick); else { node.textContent = String(target); displayedTotal = target; }
    };
    countFrame = browser.frame(tick);
  }
  function renderDonut(counts: Counts, value: number): void {
    const svg = el('dashboard-severity-donut');
    const track = el('dashboard-severity-donut-track');
    const segments = el('dashboard-severity-donut-segments');
    const labels = el('dashboard-severity-donut-labels');
    const leaders = el('dashboard-severity-donut-leaders');
    const hits = el('dashboard-severity-donut-hits');
    if (!track || !segments || !labels) return;
    browser.cancelFrame(countFrame); browser.cancelFrame(readyFrame); browser.cancelLater(hoverTimer); hideTooltip();
    bySeverity = counts; total = value; hoverId = null; defs();
    const { cx, cy, rOuter, rInner, labelOffset, gapRad } = CFG;
    const trackPath = halfRingPath(cx, cy, rOuter, rInner);
    track.innerHTML = `<path class="donut-track-shadow" d="${trackPath}"/><path class="donut-track" fill="url(#donut-track-face)" d="${trackPath}"/><path class="donut-track-vignette" fill="url(#donut-track-vignette)" d="${trackPath}"/>`;
    const visible = severities.map(id => ({ id, value: counts[id] ?? 0 })).filter(segment => segment.value > 0);
    svg?.classList.remove('is-highlighting'); svg?.removeAttribute('data-hover-severity');
    clearHighlight(); document.querySelector('.dashboard-severity-chart')?.removeAttribute('data-hover-severity');
    if (total <= 0 || !visible.length) {
      segments.innerHTML = ''; labels.innerHTML = ''; if (hits) hits.innerHTML = ''; if (leaders) leaders.innerHTML = '';
      resetCenter(); svg?.classList.remove('donut-ready'); return;
    }
    resetCenter(true);
    const sum = visible.reduce((s, segment) => s + segment.value, 0);
    const arcs = Math.max(0, Math.PI * (sum / total) - gapRad * Math.max(0, visible.length - 1));
    let cumulative = 0;
    let segmentsHtml = '', glossHtml = '', hitsHtml = '', labelsHtml = '', leadersHtml = '';
    visible.forEach((segment, index) => {
      const angleStart = Math.PI - cumulative;
      const radians = arcs * segment.value / sum;
      const angleEnd = angleStart - radians;
      const path = arcPath(cx, cy, rOuter, rInner, angleStart, angleEnd);
      const pct = segment.value / total * 100;
      const rounded = Math.round(pct);
      const name = esc(severityLabel(segment.id));
      segmentsHtml += `<path class="donut-segment seg-${segment.id}" data-severity="${segment.id}" data-count="${segment.value}" data-pct="${rounded}" fill="url(#donut-grad-${segment.id})" d="${path}"/>`;
      hitsHtml += `<path class="donut-segment-hit seg-${segment.id}" data-action="severity" data-severity="${segment.id}" fill="transparent" d="${path}" tabindex="0" role="button" aria-label="${name} ${segment.value} (${rounded}%)"/>`;
      glossHtml += `<path class="donut-segment-gloss seg-${segment.id}" data-severity="${segment.id}" fill="url(#donut-inner-gloss)" d="${arcPath(cx, cy, rOuter - 2, rInner + 6, angleStart, angleEnd)}" pointer-events="none"/>`;
      if (pct >= 5) {
        const mid = (angleStart + angleEnd) / 2;
        const sin = Math.sin(mid), cos = Math.cos(mid);
        const labelR = rOuter + labelOffset + 6;
        const lx = cx + labelR * cos;
        const ly = cy - labelR * sin - (sin > 0.4 ? Math.round((sin - 0.3) * 10) : 0);
        const anchor = cos < -0.15 ? 'end' : cos > 0.15 ? 'start' : 'middle';
        leadersHtml += `<line class="donut-leader label-${segment.id}" data-severity="${segment.id}" pathLength="100" x1="${(cx + (rOuter + 4) * cos).toFixed(1)}" y1="${(cy - (rOuter + 4) * sin).toFixed(1)}" x2="${(cx + (rOuter + labelOffset - 2) * cos).toFixed(1)}" y2="${(cy - (rOuter + labelOffset - 2) * sin).toFixed(1)}"/>`;
        labelsHtml += `<text class="donut-label-text label-${segment.id}" data-severity="${segment.id}" text-anchor="${anchor}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"><tspan x="${lx.toFixed(1)}" dy="0">${segment.value} <tspan class="donut-label-pct">(${rounded}%)</tspan></tspan><tspan class="donut-label-name" x="${lx.toFixed(1)}" dy="14">${name}</tspan></text>`;
      }
      cumulative += radians + (index < visible.length - 1 ? gapRad : 0);
    });
    segments.innerHTML = segmentsHtml + glossHtml; labels.innerHTML = labelsHtml;
    if (hits) hits.innerHTML = hitsHtml; if (leaders) leaders.innerHTML = leadersHtml;
    if (svg) { svg.classList.remove('donut-ready'); void svg.offsetWidth; readyFrame = browser.frame(() => svg.classList.add('donut-ready')); }
    countUp(total); bindDonut();
    el('dashboard-vuln-bars')?.querySelectorAll('.dashboard-severity-legend-item').forEach(item => {
      const id = item.getAttribute('data-severity'); if (!id) return;
      item.classList.toggle('is-zero', (bySeverity[id] ?? 0) === 0); item.setAttribute('aria-label', tooltipText(id));
    });
  }
  function renderTools(tools: ToolStats[] | null | undefined): void {
    const placeholder = el('dashboard-tools-pie-placeholder'), chart = el('dashboard-tools-bar-chart');
    if (!placeholder || !chart) return;
    browser.cancelLater(barTimer); if (barTooltip) barTooltip.style.display = 'none';
    const entries = (tools ?? []).filter(tool => tool.toolName && tool.totalCalls > 0).slice().sort((a, b) => b.totalCalls - a.totalCalls).slice(0, 30);
    if (!entries.length) { placeholder.style.removeProperty('display'); placeholder.textContent = t('dashboard.noCallData', null, 'No call data'); chart.style.display = 'none'; chart.innerHTML = ''; return; }
    placeholder.style.display = 'none'; chart.style.display = 'block';
    const max = Math.max(...entries.map(tool => tool.totalCalls));
    chart.innerHTML = entries.map((tool, index) => `<div class="dashboard-tools-bar-item" data-tooltip="${esc(tool.toolName)}"><span class="dashboard-tools-bar-label">${esc(tool.toolName.length > 12 ? tool.toolName.slice(0, 10) + '…' : tool.toolName)}</span><div class="dashboard-tools-bar-track"><div class="dashboard-tools-bar-fill" style="width:${tool.totalCalls / max * 100}%;background:${BAR_COLORS[index % BAR_COLORS.length]}"></div></div><span class="dashboard-tools-bar-value">${tool.totalCalls}</span></div>`).join('');
    if (barsBound) return;
    barsBound = true;
    chart.addEventListener('mouseover', event => {
      const item = closest(event.target, '.dashboard-tools-bar-item'); const value = item?.getAttribute('data-tooltip'); if (!item || !value) return;
      const node = barTooltip ??= makeTooltip('dashboard-tools-bar-tooltip');
      browser.cancelLater(barTimer);
      barTimer = browser.later(() => {
        node.textContent = value; node.style.display = 'block';
        tooltipFrame = browser.frame(() => {
          const rect = item.getBoundingClientRect(), tt = node.getBoundingClientRect();
          let y = rect.top - tt.height - 6; if (y < 8) y = rect.bottom + 6;
          const x = Math.max(8, Math.min(rect.left + rect.width / 2 - tt.width / 2, browser.viewportWidth() - tt.width - 8));
          node.style.left = `${x}px`; node.style.top = `${y}px`;
        });
      }, 180);
    }, { signal: listeners.signal });
    chart.addEventListener('mouseout', event => {
      const item = closest(event.target, '.dashboard-tools-bar-item'), related = closest(event.relatedTarget, '.dashboard-tools-bar-item');
      if (item && item === related) return;
      browser.cancelLater(barTimer); if (barTooltip) barTooltip.style.display = 'none';
    }, { signal: listeners.signal });
  }
  const themeObserver = new MutationObserver(() => renderDonut(bySeverity, total));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return {
    renderDonut, renderTools,
    dispose(): void {
      listeners.abort(); themeObserver.disconnect(); browser.cancelLater(hoverTimer); browser.cancelLater(tooltipTimer); browser.cancelLater(barTimer);
      browser.cancelFrame(countFrame); browser.cancelFrame(readyFrame); browser.cancelFrame(tooltipFrame); tooltip?.remove(); barTooltip?.remove();
    },
  };
}
