// internal/handler/monitor.go calls-timeline response and the MCP monitor trend chart.
export interface TimelinePoint { t: string; total: number; failed?: number; blocked?: number }
export interface MonitorTotals {
  total: number; success: number; failed: number; blocked: number; neutral: number; lastCallTime: Date | null;
}

export const MCP_TIMELINE_RANGES = ['24h', '7d', '30d'] as const;
export type TimelineRange = typeof MCP_TIMELINE_RANGES[number];

export function isTimelineRange(value: unknown): value is TimelineRange {
  return typeof value === 'string' && (MCP_TIMELINE_RANGES as readonly string[]).includes(value);
}

/** The saved trend range, or the 7-day default when nothing valid is stored. */
export function resolveTimelineRange(saved: string | null | undefined): TimelineRange {
  return isTimelineRange(saved) ? saved : '7d';
}

export function buildMonitorTotals(summary: object | null | undefined): MonitorTotals {
  const s = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
  const total = Number(s.totalCalls ?? 0) || 0;
  const success = Number(s.successCalls ?? 0) || 0;
  const failed = Number(s.failedCalls ?? 0) || 0;
  const blocked = Number(s.blockedCalls ?? 0) || 0;
  const last = s.lastCallTime;
  return {
    total, success, failed, blocked,
    neutral: Math.max(0, total - success - failed - blocked),
    lastCallTime: last ? new Date(last as string) : null,
  };
}

/** Axis and tooltip label for one bucket: time only for 24h, date only for 30d, both otherwise. */
export function formatTimelineLabel(value: Date | string, range: TimelineRange, locale: string | undefined): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  if (range === '24h') return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (range === '30d') return d.toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  return d.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The bar-and-line trend SVG. Failed and blocked calls are drawn over the total, and the peak bucket is
 * marked. Returns an empty string when there is nothing to draw.
 */
export function buildTimelineSvg(points: readonly TimelinePoint[], range: TimelineRange, locale: string | undefined, label = formatTimelineLabel): string {
  if (points.length === 0) return '';
  const W = 400, H = 140, padL = 32, padR = 8, padT = 12, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...points.map(p => p.total || 0));
  const hasFailed = points.some(p => (p.failed || 0) > 0);
  const hasBlocked = points.some(p => (p.blocked || 0) > 0);
  const barGap = points.length > 48 ? 1 : 2;
  const barW = Math.max(1.6, Math.min(8, (plotW / Math.max(1, points.length)) - barGap));

  const coords = points.map((p, i) => {
    const x = padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = padT + plotH - ((p.total || 0) / maxVal) * plotH;
    return { x, y, p, i };
  });
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');
  const baseY = padT + plotH;
  const last = coords[coords.length - 1]!;
  const first = coords[0]!;
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${baseY} L ${first.x.toFixed(2)} ${baseY} Z`;

  const failPath = hasFailed ? coords.map((c, i) => {
    const fy = padT + plotH - ((c.p.failed || 0) / maxVal) * plotH;
    return `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${fy.toFixed(2)}`;
  }).join(' ') : '';
  const blockedPath = hasBlocked ? coords.map((c, i) => {
    const y = padT + plotH - ((c.p.blocked || 0) / maxVal) * plotH;
    return `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') : '';

  let peakIdx = 0;
  points.forEach((p, i) => { if ((p.total || 0) >= (points[peakIdx]!.total || 0)) peakIdx = i; });

  const yTicks = [0, Math.ceil(maxVal / 2), maxVal];
  const yLines = yTicks.map(v => {
    const y = padT + plotH - (v / maxVal) * plotH;
    const base = v === 0 ? ' mcp-stats-timeline-grid--base' : '';
    return `<line class="mcp-stats-timeline-grid${base}" x1="${padL}" y1="${y.toFixed(2)}" x2="${W - padR}" y2="${y.toFixed(2)}" />` +
      `<text class="mcp-stats-timeline-y" x="${padL - 4}" y="${(y + 3.5).toFixed(2)}">${v}</text>`;
  }).join('');

  const tickIdx = points.length <= 2 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const xLabels = tickIdx.map((idx, ti) => {
    const c = coords[idx]!;
    let anchor = 'middle';
    if (tickIdx.length > 1) {
      if (ti === 0) anchor = 'start';
      else if (ti === tickIdx.length - 1) anchor = 'end';
    }
    return `<text class="mcp-stats-timeline-axis" x="${c.x.toFixed(2)}" y="${H - 5}" text-anchor="${anchor}">${escape(label(c.p.t, range, locale))}</text>`;
  }).join('');

  const dots = coords.map(c => {
    const tip = escape(label(c.p.t, range, locale));
    const isPeak = c.i === peakIdx && (c.p.total || 0) > 0;
    const cls = 'mcp-stats-timeline-dot' + (isPeak ? ' mcp-stats-timeline-dot--peak' : '');
    return `<circle class="${cls}" cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${isPeak ? 2 : 1.5}" data-time="${tip}" data-total="${c.p.total || 0}" data-failed="${c.p.failed || 0}" data-blocked="${c.p.blocked || 0}" />`;
  }).join('');

  const bars = coords.map(c => {
    const total = c.p.total || 0, failed = c.p.failed || 0, blocked = c.p.blocked || 0;
    const h = total > 0 ? Math.max(3, (total / maxVal) * plotH) : 1;
    const y = baseY - h;
    const failedH = total > 0 ? h * (failed / total) : 0;
    const blockedH = total > 0 ? h * (blocked / total) : 0;
    const tip = escape(label(c.p.t, range, locale));
    const data = `data-time="${tip}" data-total="${total}" data-failed="${failed}" data-blocked="${blocked}"`;
    const x = (c.x - barW / 2).toFixed(2);
    return `<g class="mcp-stats-timeline-bar-group">
      <rect class="mcp-stats-timeline-bar${total > 0 ? ' is-active' : ''}" x="${x}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="1.6" ${data} />
      ${failedH > 0 ? `<rect class="mcp-stats-timeline-bar-fail" x="${x}" y="${(baseY - failedH).toFixed(2)}" width="${barW.toFixed(2)}" height="${failedH.toFixed(2)}" rx="1.6" ${data} />` : ''}
      ${blockedH > 0 ? `<rect class="mcp-stats-timeline-bar-blocked" x="${x}" y="${(baseY - failedH - blockedH).toFixed(2)}" width="${barW.toFixed(2)}" height="${blockedH.toFixed(2)}" rx="1.6" ${data} />` : ''}
    </g>`;
  }).join('');

  const peakC = coords[peakIdx]!;
  const peakMarker = (peakC.p.total || 0) > 0
    ? `<circle class="mcp-stats-timeline-peak-glow" cx="${peakC.x.toFixed(2)}" cy="${peakC.y.toFixed(2)}" r="5" />`
    : '';

  return `<svg class="mcp-stats-timeline__chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="mcpTimelineAreaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28"/>
        <stop offset="85%" stop-color="#3b82f6" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="mcpTimelineLineStroke" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#60a5fa"/>
        <stop offset="50%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>
    </defs>
    ${yLines}
    <path class="mcp-stats-timeline-area" d="${areaPath}" fill="url(#mcpTimelineAreaFill)" />
    ${bars}
    ${peakMarker}
    <path class="mcp-stats-timeline-line" d="${linePath}" stroke="url(#mcpTimelineLineStroke)" />
    ${hasFailed ? `<path class="mcp-stats-timeline-line mcp-stats-timeline-line--fail" d="${failPath}" />` : ''}
    ${hasBlocked ? `<path class="mcp-stats-timeline-line mcp-stats-timeline-line--blocked" d="${blockedPath}" />` : ''}
    ${dots}
    ${xLabels}
  </svg>`;
}

/** Stable render key: the view re-renders a block only when its serialised input changes. */
export function renderKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(Date.now());
  }
}
