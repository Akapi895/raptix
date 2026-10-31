// MCP monitor statistics: KPI bar, the combined tools/trend panel and the trend body. Only the markup that
// renderMonitorStats reaches is here; the earlier donut and table variants had no callers and are gone.
import { buildTimelineSvg, formatTimelineLabel, buildMonitorTotals, MCP_TIMELINE_RANGES, type TimelinePoint, type TimelineRange, resolveTimelineRange } from './timeline';
import { formatMonitorToolName, monitorToolNamesEqual, type MonitorSummary, type MonitorToolStat } from './model';

export const MCP_STATS_TOP_N = 6;
export const MCP_STATS_DIST_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899'];
export const MCP_STATS_CHART_MIN_PCT = 5;

export const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Text lookup for the panel. A key the resources lack falls back to the English literal. */
export interface StatsText {
  locale: string;
  /** Translation of `mcpMonitor.<key>`, or an empty string when the key is missing. */
  t(key: string, params?: Record<string, unknown>): string;
  formatTime(value: Date): string;
}

export function txt(ctx: StatsText, key: string, en: string, params?: Record<string, unknown>): string {
  const translated = ctx.t(key, params);
  if (translated) return translated;
  return en;
}

export type ToolRateClass = 'is-success' | 'is-warning' | 'is-danger' | 'is-muted';
export function toolRateClass(rate: number): ToolRateClass {
  if (rate >= 95) return 'is-success';
  if (rate >= 80) return 'is-warning';
  return 'is-danger';
}

export function statsRateTone(rate: number): string {
  return toolRateClass(rate);
}

export interface StatsInput {
  summary: MonitorSummary | null;
  topTools: MonitorToolStat[];
  lastFetchedAt: Date | null;
  retentionDays: number;
  activeToolFilter: string;
  timeline: { range?: string; points?: TimelinePoint[]; summary?: { totalCalls?: number; peak?: number; peakAt?: string } } | null;
  timelineError: string | null;
  timelineLoading: boolean;
  timelineRange: TimelineRange;
}

/** Donut and stacked-bar segments. Small tools are folded into "others" only when asked to. */
export function chartSegments(topTools: readonly MonitorToolStat[], total: number, groupSmall: boolean, ctx: StatsText) {
  const othersLabel = txt(ctx, 'distOthers', 'Other tools');
  const topNTotal = topTools.reduce((sum, tool) => sum + (tool.totalCalls || 0), 0);
  let bundled = Math.max(0, total - topNTotal);
  const segments: { color: string; name: string; calls: number; pct: string; pctNum: number; isOthers: boolean }[] = [];
  topTools.forEach((tool, i) => {
    const calls = tool.totalCalls || 0;
    if (calls <= 0 || total <= 0) return;
    const pct = (calls / total) * 100;
    if (groupSmall && pct < MCP_STATS_CHART_MIN_PCT) { bundled += calls; return; }
    segments.push({ color: MCP_STATS_DIST_COLORS[i % MCP_STATS_DIST_COLORS.length]!, name: tool.toolName || '', calls, pct: pct.toFixed(1), pctNum: pct, isOthers: false });
  });
  if (bundled > 0 && total > 0) {
    const pct = (bundled / total) * 100;
    segments.push({ color: '#cbd5e1', name: othersLabel, calls: bundled, pct: pct.toFixed(1), pctNum: pct, isOthers: true });
  }
  return segments;
}

export function renderMetricsBar(totals: ReturnType<typeof buildMonitorTotals>, successRate: string, rateTone: string, rateSubText: string, lastCallText: string, hasCalls: boolean, ctx: StatsText): string {
  const totalCallsLabel = txt(ctx, 'totalCalls', 'Total calls');
  const successRateLabel = txt(ctx, 'successRate', 'Success rate');
  const lastCallLabel = txt(ctx, 'lastCall', 'Last call');
  const successPill = txt(ctx, 'successCount', `Success ${totals.success}`, { n: totals.success });
  const failedPill = txt(ctx, 'failedCount', `Failed ${totals.failed}`, { n: totals.failed });
  const blockedPill = txt(ctx, 'blockedCount', `Blocked ${totals.blocked}`, { n: totals.blocked });
  const neutralPill = txt(ctx, 'neutralCount', `Stopped ${totals.neutral}`, { n: totals.neutral });
  const rateHint = txt(ctx, 'rateExcludesBlocked', 'Success rate includes only successful and failed calls; blocked and stopped calls are excluded');
  const rateValue = hasCalls ? `${successRate}%` : successRate;
  const blockedChip = totals.blocked > 0 ? `<span class="mcp-stats-kpi__chip is-blocked">${esc(blockedPill)}</span>` : '';
  const neutralChip = totals.neutral > 0 ? `<span class="mcp-stats-kpi__chip is-neutral">${esc(neutralPill)}</span>` : '';
  return `
    <div class="mcp-stats-kpi" role="group" aria-label="${esc(totalCallsLabel)}">
      <article class="mcp-stats-kpi__item mcp-stats-kpi__item--calls">
        <span class="mcp-stats-kpi__accent" aria-hidden="true"></span>
        <div class="mcp-stats-kpi__content">
          <span class="mcp-stats-kpi__label">${esc(totalCallsLabel)}</span>
          <span class="mcp-stats-kpi__value">${totals.total}</span>
          <div class="mcp-stats-kpi__meta">
            <span class="mcp-stats-kpi__chip is-ok">${esc(successPill)}</span>
            <span class="mcp-stats-kpi__chip is-fail">${esc(failedPill)}</span>
            ${blockedChip}
            ${neutralChip}
          </div>
        </div>
      </article>
      <article class="mcp-stats-kpi__item mcp-stats-kpi__item--rate">
        <span class="mcp-stats-kpi__accent" aria-hidden="true"></span>
        <div class="mcp-stats-kpi__content">
          <span class="mcp-stats-kpi__label" title="${esc(rateHint)}">${esc(successRateLabel)}</span>
          <span class="mcp-stats-kpi__value mcp-stats-kpi__value--rate ${rateTone}">${rateValue}</span>
          <span class="mcp-stats-kpi__status ${rateTone}">${esc(rateSubText)}</span>
        </div>
      </article>
      <article class="mcp-stats-kpi__item mcp-stats-kpi__item--time">
        <span class="mcp-stats-kpi__accent" aria-hidden="true"></span>
        <div class="mcp-stats-kpi__content">
          <span class="mcp-stats-kpi__label">${esc(lastCallLabel)}</span>
          <time class="mcp-stats-kpi__value mcp-stats-kpi__value--time">${esc(lastCallText)}</time>
        </div>
      </article>
    </div>`;
}

const RANGE_LABEL_KEYS: Record<TimelineRange, string> = { '24h': 'timelineRange24h', '7d': 'timelineRange7d', '30d': 'timelineRange30d' };

export function rangeLabel(range: TimelineRange, ctx: StatsText): string {
  return txt(ctx, RANGE_LABEL_KEYS[range], range === '24h' ? '24 hours' : range === '30d' ? '30 days' : '7 days');
}

export function renderScopeBadges(showTools: boolean, showTimeline: boolean, range: TimelineRange, ctx: StatsText): string {
  const parts: string[] = [];
  if (showTools) {
    parts.push(`<span class="mcp-stats-scope-badge mcp-stats-scope-badge--cumulative">${esc(txt(ctx, 'scopeCumulative', 'Cumulative'))}</span>`);
  }
  if (showTimeline) {
    parts.push(`<span class="mcp-stats-scope-badge mcp-stats-scope-badge--timeline">${esc(rangeLabel(range, ctx))}</span>`);
  }
  return parts.length ? `<div class="mcp-stats-combined__scopes" role="note">${parts.join('')}</div>` : '';
}

export function renderRangeButtons(active: TimelineRange, ctx: StatsText): string {
  return MCP_TIMELINE_RANGES.map(range => `<button type="button" class="mcp-stats-timeline__range${active === range ? ' is-active' : ''}"
    data-range="${range}" aria-pressed="${active === range ? 'true' : 'false'}">${esc(rangeLabel(range, ctx))}</button>`).join('');
}

const EMPTY_ICON = '<svg class="mcp-stats-timeline-empty-state__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';

export function renderTimelineEmpty(compact: boolean, ctx: StatsText): string {
  const noData = txt(ctx, 'timelineNoData', 'No calls in this period');
  const hint = txt(ctx, 'timelineEmptyHint', 'Switch the time range or invoke MCP tools in chat or tasks');
  return `<div class="mcp-stats-timeline-empty-state${compact ? ' mcp-stats-timeline-empty-state--compact' : ''}">
    ${EMPTY_ICON}
    <p class="mcp-stats-timeline-empty-state__title">${esc(noData)}</p>
    <p class="mcp-stats-timeline-empty-state__hint">${esc(hint)}</p>
  </div>`;
}

/** Index of the busiest bucket; the earliest wins a tie. */
function peakIndex(points: readonly TimelinePoint[]): number {
  let idx = 0;
  points.forEach((p, i) => { if ((p.total || 0) >= (points[idx]!.total || 0)) idx = i; });
  return idx;
}

export function sparseHint(points: readonly TimelinePoint[], timeline: NonNullable<StatsInput['timeline']>, range: TimelineRange, ctx: StatsText): string {
  if (points.length < 4 || !timeline.summary) return '';
  const summaryTotal = timeline.summary.totalCalls || 0;
  const peak = timeline.summary.peak || 0;
  if (summaryTotal === 0 || peak === 0) return '';
  const nonZero = points.filter(p => (p.total || 0) > 0).length;
  const idx = peakIndex(points);
  const peakNearEnd = idx >= Math.floor(points.length * 0.8);
  if (nonZero / points.length > 0.3 && !peakNearEnd) return '';
  const peakAt = timeline.summary.peakAt;
  const peakTime = formatTimelineLabel(peakAt ?? points[idx]!.t, range, ctx.locale);
  return txt(ctx, 'timelineSparseHint', `Most of this period had no calls; the peak of ${peak} was at ${peakTime}`, { peak, peakTime });
}

export function activeMoments(points: readonly TimelinePoint[], range: TimelineRange, ctx: StatsText): string {
  const active = points.map((p, i) => ({ ...p, i })).filter(p => (p.total || 0) > 0).sort((a, b) => (b.total || 0) - (a.total || 0) || b.i - a.i);
  if (active.length === 0) return '';
  const shown = active.slice(0, 4);
  const hidden = Math.max(0, active.length - shown.length);
  const label = txt(ctx, 'timelineActiveMoments', 'Active moments');
  const moreLabel = txt(ctx, 'timelineMoreMoments', `+${hidden}`, { n: hidden });
  const chips = shown.map(p => {
    const time = formatTimelineLabel(p.t, range, ctx.locale);
    const failed = p.failed || 0;
    const blocked = p.blocked || 0;
    return `<span class="mcp-stats-timeline-moment" title="${esc(time)}">
      <span class="mcp-stats-timeline-moment__time">${esc(time)}</span>
      <span class="mcp-stats-timeline-moment__count">${p.total || 0}</span>
      ${failed > 0 ? `<span class="mcp-stats-timeline-moment__fail">${esc(txt(ctx, 'failedCount', `Failed ${failed}`, { n: failed }))}</span>` : ''}
      ${blocked > 0 ? `<span class="mcp-stats-timeline-moment__blocked">${esc(txt(ctx, 'blockedCount', `Blocked ${blocked}`, { n: blocked }))}</span>` : ''}
    </span>`;
  }).join('');
  const more = hidden > 0
    ? `<span class="mcp-stats-timeline-moment mcp-stats-timeline-moment--more" title="${esc(txt(ctx, 'timelineMoreMomentsTitle', `${hidden} more active periods`, { n: hidden }))}">${esc(moreLabel)}</span>`
    : '';
  return `<div class="mcp-stats-timeline-moments">
    <span class="mcp-stats-timeline-moments__label">${esc(label)}</span>
    <div class="mcp-stats-timeline-moments__list">${chips}${more}</div>
  </div>`;
}

export function renderTimelineBody(input: StatsInput, compact: boolean, ctx: StatsText): string {
  if (input.timelineLoading) {
    return `<div class="monitor-empty monitor-empty--inline">${esc(txt(ctx, 'timelineLoading', 'Loading trend…'))}</div>`;
  }
  if (input.timelineError) {
    return `<p class="mcp-stats-timeline-error">${esc(txt(ctx, 'timelineLoadError', 'Failed to load call trend'))}:${esc(input.timelineError)}</p>`;
  }
  const timeline = input.timeline;
  const points = timeline?.points ?? [];
  const summaryTotal = timeline?.summary?.totalCalls ?? 0;
  const peak = timeline?.summary?.peak ?? 0;
  if (!timeline || points.length === 0 || summaryTotal === 0) return renderTimelineEmpty(compact, ctx);

  const range = resolveTimelineRange(timeline.range ?? input.timelineRange);
  const hint = txt(ctx, 'timelineHint', 'All tools combined');
  const summaryText = txt(ctx, 'timelineSummary', `${summaryTotal} calls in range · peak ${peak}`, { total: summaryTotal, peak });
  const svg = buildTimelineSvg(points, range, ctx.locale, (value, r, locale) => formatTimelineLabel(value, r, locale));
  const hasFailed = points.some(p => (p.failed || 0) > 0);
  const hasBlocked = points.some(p => (p.blocked || 0) > 0);
  const sparse = sparseHint(points, timeline, range, ctx);
  return `
    <p class="mcp-stats-timeline__inline-meta">${esc(hint)} · ${esc(summaryText)}</p>
    ${activeMoments(points, range, ctx)}
    <div class="mcp-stats-timeline__chart-wrap">${svg}</div>
    ${sparse ? `<p class="mcp-stats-timeline__sparse-hint">${esc(sparse)}</p>` : ''}
    <div class="mcp-stats-timeline__legend">
      <span class="mcp-stats-timeline__legend-item">${esc(txt(ctx, 'timelineTotalLegend', 'Total calls'))}</span>
      ${hasFailed ? `<span class="mcp-stats-timeline__legend-item mcp-stats-timeline__legend-item--fail">${esc(txt(ctx, 'timelineFailedLegend', 'Failed'))}</span>` : ''}
      ${hasBlocked ? `<span class="mcp-stats-timeline__legend-item mcp-stats-timeline__legend-item--blocked">${esc(txt(ctx, 'timelineBlockedLegend', 'Blocked'))}</span>` : ''}
    </div>`;
}

export function renderToolsPanel(topTools: readonly MonitorToolStat[], total: number, activeToolFilter: string, ctx: StatsText): string {
  const segments = chartSegments(topTools, total, false, ctx);
  const topNTotal = topTools.reduce((sum, tool) => sum + (tool.totalCalls || 0), 0);
  const topNShare = total > 0 ? ((topNTotal / total) * 100).toFixed(1) : '0.0';
  const caption = txt(ctx, 'rankingSummary', `Top ${MCP_STATS_TOP_N} is ${topNShare}% · ${total} total`, { n: MCP_STATS_TOP_N, pct: topNShare, total });
  const unknownTool = txt(ctx, 'unknownTool', 'Unknown tool');
  const distAria = txt(ctx, 'distTitle', 'Call distribution');

  const stacked = segments.map(s => {
    const active = !s.isOthers && activeToolFilter && monitorToolNamesEqual(activeToolFilter, s.name);
    const display = s.isOthers ? s.name : formatMonitorToolName(s.name);
    const title = `${display} · ${s.pct}% · ${s.calls}`;
    if (s.isOthers) {
      return `<span class="mcp-stats-proportion-seg is-others" data-is-others="1" role="presentation" style="flex:${s.pctNum} 1 0;background:${s.color}" title="${esc(title)}"></span>`;
    }
    const aria = txt(ctx, 'distSegmentAria', `${display}, ${s.pct}% of calls, ${s.calls} calls`, { name: display, pct: s.pct, calls: s.calls });
    return `<span class="mcp-stats-proportion-seg${active ? ' is-active' : ''}" data-tool-name="${esc(s.name)}" data-pct="${s.pct}" data-calls="${s.calls}" data-is-others="0"
      role="button" tabindex="0" aria-label="${esc(aria)}" style="flex:${s.pctNum} 1 0;background:${s.color}" title="${esc(title)}"></span>`;
  }).join('');

  const maxCalls = Math.max(1, ...topTools.map(tool => tool.totalCalls || 0));
  const list = topTools.map((tool, index) => {
    const rawName = tool.toolName || unknownTool;
    const name = formatMonitorToolName(rawName);
    const calls = tool.totalCalls || 0;
    const success = tool.successCalls || 0;
    const failed = tool.failedCalls || 0;
    const blocked = tool.blockedCalls || 0;
    const effective = success + failed;
    const rateNum = effective > 0 ? (success / effective) * 100 : 0;
    const rate = rateNum.toFixed(1);
    const rateText = effective > 0 ? `${rate}%` : '-';
    const share = total > 0 ? ((calls / total) * 100).toFixed(1) : '0.0';
    const color = MCP_STATS_DIST_COLORS[index % MCP_STATS_DIST_COLORS.length]!;
    const barPct = maxCalls > 0 ? ((calls / maxCalls) * 100).toFixed(1) : '0';
    const active = activeToolFilter && monitorToolNamesEqual(activeToolFilter, rawName);
    const rateClass = effective > 0 ? toolRateClass(rateNum) : 'is-muted';
    const rank = index === 0 ? ' rank-1' : index === 1 ? ' rank-2' : index === 2 ? ' rank-3' : '';
    const blockedLabel = txt(ctx, 'blockedCount', `Blocked ${blocked}`, { n: blocked });
    const base = effective > 0
      ? txt(ctx, 'toolRowAriaLabel', `${name}, ${calls} calls, ${rate}% success`, { name, total: calls, rate })
      : txt(ctx, 'toolRowNoCompletedAriaLabel', `${name}, ${calls} calls, no completed outcomes, click to view records`, { name, total: calls });
    const rowAria = base + (blocked > 0 ? ` · ${blockedLabel}` : '');
    const failNote = failed > 0 ? `<span class="mcp-stats-tool-item__fail">${esc(txt(ctx, 'failedCount', `Failed ${failed}`, { n: failed }))}</span>` : '';
    const successLabel = txt(ctx, 'successCount', `Success ${success}`, { n: success });
    const failedLabel = txt(ctx, 'failedCount', `Failed ${failed}`, { n: failed });
    return `<li class="mcp-stats-tool-item${active ? ' is-active' : ''}" data-tool-name="${esc(rawName)}" tabindex="0" role="button"
      aria-label="${esc(rowAria)}" aria-pressed="${active ? 'true' : 'false'}">
      <div class="mcp-stats-tool-item__top">
        <span class="mcp-stats-tool-item__rank mcp-stats-rank${rank}">${index + 1}</span>
        <span class="mcp-stats-tool-item__dot" style="background:${color}" aria-hidden="true"></span>
        <span class="mcp-stats-tool-item__name" title="${esc(name)}">${esc(name)}</span>
        <span class="mcp-stats-tool-item__share">${share}%</span>
      </div>
      <div class="mcp-stats-tool-item__middle">
        <strong class="mcp-stats-tool-item__calls">${calls}</strong>
        <span class="mcp-stats-tool-item__calls-label">${esc(txt(ctx, 'columnCalls', 'Calls'))}</span>
        <span class="mcp-stats-tool-item__track" aria-hidden="true"><span class="mcp-stats-tool-item__fill" style="width:${barPct}%;background:${color}"></span></span>
      </div>
      <div class="mcp-stats-tool-item__bottom">
        <span class="mcp-stats-tool-item__pill is-success">${esc(successLabel)}</span>
        <span class="mcp-stats-tool-item__pill${failed > 0 ? ' is-danger' : ''}">${esc(failedLabel)}</span>
        ${blocked > 0 ? `<span class="mcp-stats-tool-item__pill is-blocked">${esc(blockedLabel)}</span>` : ''}
        <span class="mcp-stats-tool-item__rate ${rateClass}">${rateText}${failNote}</span>
      </div>
    </li>`;
  }).join('');

  return `
    <div class="mcp-stats-tools-panel" role="region" aria-label="${esc(txt(ctx, 'toolStatsTitle', 'Tool statistics'))}">
      <div class="mcp-stats-tools-panel__hero">
        <div class="mcp-stats-proportion-bar" role="img" aria-label="${esc(distAria)}">${stacked}</div>
        <p class="mcp-stats-tools-panel__caption">
          <span class="mcp-stats-scope-badge mcp-stats-scope-badge--cumulative mcp-stats-scope-badge--inline">${esc(txt(ctx, 'scopeCumulative', 'Cumulative'))}</span>
          ${esc(caption)}
        </p>
      </div>
      <ol class="mcp-stats-tools-panel__list">${list}</ol>
    </div>`;
}

/** The combined panel: tools on the left when there are any, the trend on the right when it has data. */
export function renderCombinedSection(topTools: readonly MonitorToolStat[], total: number, activeToolFilter: string, input: StatsInput, showTimeline: boolean, ctx: StatsText): string {
  const statsTitle = txt(ctx, 'toolStatsTitle', 'Tool statistics');
  const timelineTitle = txt(ctx, 'timelineTitle', 'Call trend');
  const statsHint = txt(ctx, 'toolStatsHint', 'Click a bar segment or row to filter records below');
  const hasTools = topTools.length > 0;
  if (!hasTools && !showTimeline) return '';

  const filterLabel = activeToolFilter ? formatMonitorToolName(activeToolFilter) : '';
  const filterChip = activeToolFilter ? `<span class="mcp-stats-filter-chip" title="${esc(txt(ctx, 'filterByToolTitle', `${filterLabel}`, { tool: filterLabel }))}">
      <span class="mcp-stats-filter-chip__label">${esc(txt(ctx, 'filterActive', `Filtered: ${filterLabel}`, { tool: filterLabel }))}</span>
      <button type="button" class="mcp-stats-filter-chip__clear mcp-stats-clear-filter" aria-label="${esc(txt(ctx, 'clearToolFilter', 'Clear tool filter'))}">×</button>
    </span>` : '';
  const range = resolveTimelineRange(input.timelineRange);
  const rangeButtons = showTimeline ? `<div class="mcp-stats-timeline__ranges" role="group" aria-label="${esc(timelineTitle)}">${renderRangeButtons(range, ctx)}</div>` : '';
  const panelTitle = showTimeline && hasTools ? `${statsTitle} · ${timelineTitle}` : (hasTools ? statsTitle : timelineTitle);
  const scopes = renderScopeBadges(hasTools, showTimeline, range, ctx);
  const metaHint = hasTools ? statsHint : '';
  const timelineCol = showTimeline ? `<div class="mcp-stats-combined__timeline">
      <p class="mcp-stats-combined__col-label">${esc(timelineTitle)}</p>
      <div class="mcp-stats-combined__timeline-inner">${renderTimelineBody(input, hasTools, ctx)}</div>
    </div>` : '';
  let bodyMod = 'mcp-stats-combined__body';
  if (hasTools && showTimeline) bodyMod += ' mcp-stats-combined__body--full';
  else if (hasTools) bodyMod += ' mcp-stats-combined__body--tools';
  else bodyMod += ' mcp-stats-combined__body--timeline';
  const main = hasTools ? `<div class="mcp-stats-combined__main">${renderToolsPanel(topTools, total, activeToolFilter, ctx)}</div>` : '';
  return `
    <section class="mcp-stats-combined" aria-label="${esc(panelTitle)}">
      <header class="mcp-stats-combined__head">
        <div class="mcp-stats-combined__head-text">
          <h4 class="mcp-stats-combined__title">${esc(panelTitle)}</h4>
          <div class="mcp-stats-combined__meta-row">
            ${scopes}
            ${metaHint ? `<p class="mcp-stats-combined__meta">${esc(metaHint)}</p>` : ''}
          </div>
        </div>
        <div class="mcp-stats-combined__actions">
          ${filterChip}
          ${rangeButtons}
        </div>
      </header>
      <div class="${bodyMod}">
        ${main}
        ${timelineCol}
      </div>
    </section>`;
}

export function subtitleText(lastFetchedAt: Date | null, toolCount: number, retentionDays: number, ctx: StatsText): string {
  const timeText = lastFetchedAt ? ctx.formatTime(lastFetchedAt) : '—';
  let text = txt(ctx, 'statsSubtitle', `Refreshed ${timeText} · ${toolCount} tools`, { time: timeText, count: toolCount });
  if (retentionDays > 0) {
    text += ' · ' + txt(ctx, 'retentionHint', `Execution records are kept for ${retentionDays} days, then purged automatically.`, { days: retentionDays });
  }
  return text;
}

/** The whole stats block, or an empty-state message when there is nothing to show. */
export function renderStats(input: StatsInput, ctx: StatsText): { html: string; empty: boolean; subtitle: string } {
  const tools = input.topTools;
  const totals = buildMonitorTotals(input.summary);
  const toolCount = input.summary && typeof input.summary.toolCount === 'number' ? input.summary.toolCount : tools.length;
  const showTimeline = input.timelineLoading || input.timeline != null || !!input.timelineError;
  const hasSummary = toolCount > 0 || totals.total > 0;
  if (!hasSummary && !showTimeline) {
    return { html: `<div class="monitor-empty">${esc(txt(ctx, 'noStatsData', 'No statistical data'))}</div>`, empty: true, subtitle: '' };
  }
  const effective = totals.success + totals.failed;
  const hasCalls = effective > 0;
  const rateNum = hasCalls ? (totals.success / effective) * 100 : 0;
  const successRate = hasCalls ? rateNum.toFixed(1) : '-';
  const noCallsYet = txt(ctx, 'noCallsYet', 'No calls yet');
  const noCompletedYet = txt(ctx, 'noCompletedYet', 'No completed outcomes yet');
  const lastCallText = totals.lastCallTime ? ctx.formatTime(totals.lastCallTime) : noCallsYet;
  const rateTone = hasCalls ? statsRateTone(rateNum) : 'is-muted';
  let rateSub = totals.total > 0 ? noCompletedYet : noCallsYet;
  if (hasCalls) {
    rateSub = txt(ctx, 'rateHealthy', 'Running smoothly');
    if (rateNum < 80) rateSub = txt(ctx, 'rateCritical', 'High failure rate');
    else if (rateNum < 95) rateSub = txt(ctx, 'rateWarning', 'Some failures detected');
  }
  const hasAnyCalls = totals.total > 0;
  const showCombined = hasAnyCalls && (tools.length > 0 || showTimeline);
  const html = `<div class="mcp-exec-stats">
    ${renderMetricsBar(totals, successRate, rateTone, rateSub, lastCallText, hasCalls, ctx)}
    ${showCombined ? renderCombinedSection(tools, totals.total, input.activeToolFilter, input, showTimeline, ctx) : ''}
  </div>`;
  return { html, empty: false, subtitle: subtitleText(input.lastFetchedAt, toolCount, input.retentionDays, ctx) };
}
