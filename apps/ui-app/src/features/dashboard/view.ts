import { dashboardBrowser as browser } from '../../platform/dashboard-browser';
import { createDashboardAlerts } from './alerts';
import { createDashboardCharts } from './charts';
import { createDashboardDom, esc, formatNumber, formatTokenUsageCompact, navigateAction } from './dom';
import { createDashboardFeeds } from './feeds';
import type { DashboardService, DashboardObserver } from './service';
import { normalizeStatus } from './service';
import { severities, type DashboardDependencies, type DashboardModel, type SeverityStatus } from './types';


export function createDashboardView(document: Document, dependencies: DashboardDependencies) {
  const dom = createDashboardDom(document, dependencies);
  const { el, text, hidden, t, sub, progress, timeAgo } = dom;
  const root = el('page-dashboard');
  const listeners = new AbortController();
  let service: DashboardService | null = null;
  const deferred = new Set<number>();
  const charts = createDashboardCharts(dom, severity => navigateVulnerabilities({ severity, status: service?.getStatus() }));
  const feeds = createDashboardFeeds(dom);
  const alerts = createDashboardAlerts(dom);

  function later(callback: () => void): void {
    const id = browser.later(() => { deferred.delete(id); callback(); }, 350); deferred.add(id);
  }
  function navigateVulnerabilities(options: { severity?: string; status?: string } = {}): void {
    const params = new URLSearchParams();
    if (options.severity) params.set('severity', options.severity);
    if (options.status) params.set('status', options.status);
    const query = params.toString(); browser.setHash(query ? `vulnerabilities?${query}` : 'vulnerabilities');
  }
  function switchFeedTab(value: string): void { if (service) feeds.switchTab(service.setFeedTab(value)); }
  function switchAccessTab(value: string): void {
    if (!service) return;
    const tab = service.setAccessTab(value);
    for (const value of ['c2', 'webshell'] as const) {
      const node = el(`dashboard-access-tab-${value}`); node?.classList.toggle('is-active', value === tab); node?.setAttribute('aria-selected', String(value === tab));
      hidden(`dashboard-access-panel-${value}`, value !== tab);
    }
    const link = el('dashboard-access-view-all');
    if (link) {
      navigateAction(link, tab === 'webshell' ? 'webshell' : 'c2-listeners');
      const key = tab === 'webshell' ? 'dashboard.webshellGoManage' : 'dashboard.c2GoManage';
      link.setAttribute('data-i18n', key); link.textContent = t(key, null, tab === 'webshell' ? 'Open WebShell →' : 'Open C2 →');
    }
  }
  function syncAccessTabs(): void {
    const section = el('dashboard-section-access'); if (!section || section.hidden || !service) return;
    const c2 = section.dataset.c2Available === '1', ws = section.dataset.webshellAvailable === '1';
    hidden('dashboard-access-tab-c2', !c2); hidden('dashboard-access-tab-webshell', !ws); hidden('dashboard-access-tabs', false);
    let tab = service.getAccessTab();
    if (tab === 'c2' && !c2) tab = 'webshell';
    if (tab === 'webshell' && !ws) tab = 'c2';
    if (!c2 && ws) tab = 'webshell'; if (c2 && !ws) tab = 'c2';
    switchAccessTab(tab);
  }
  function renderAccess(model: DashboardModel): void {
    const section = el('dashboard-section-access'); if (!section) return;
    const r = model.responses;
    const c2 = dependencies.isC2Enabled() && (r.listeners !== null || r.sessions !== null || r.c2Tasks !== null);
    const ws = r.webshell !== null;
    section.dataset.c2Available = c2 ? '1' : '0'; section.dataset.webshellAvailable = ws ? '1' : '0';
    section.hidden = !c2 && !ws; if (section.hidden) return;
    if (c2) {
      text('dashboard-c2-listeners-running', r.listeners ? String((r.listeners.listeners ?? []).filter(item => item.status?.toLowerCase() === 'running').length) : '-');
      text('dashboard-c2-sessions-online', r.sessions ? String((r.sessions.sessions ?? []).filter(item => ['active', 'sleeping'].includes(item.status?.toLowerCase())).length) : '-');
      text('dashboard-c2-tasks-pending', r.c2Tasks ? String(r.c2Tasks.pending_queued_count ?? 0) : '-');
    }
    if (ws) {
      text('dashboard-webshell-connections', formatNumber(model.webshell.length));
      const list = el('dashboard-webshell-recent');
      if (list) {
        list.innerHTML = ''; list.hidden = !model.webshell.length;
        for (const connection of model.webshell.slice(0, 3)) {
          const item = document.createElement('div'); item.className = 'dashboard-webshell-recent-item'; item.setAttribute('role', 'button'); item.tabIndex = 0;
          navigateAction(item, 'webshell');
          const label = connection.remark?.trim() || connection.url?.trim() || connection.id || '';
          item.innerHTML = `<span class="dashboard-webshell-recent-type">${esc((connection.type || 'shell').toUpperCase())}</span><span class="dashboard-webshell-recent-label" title="${esc(label)}">${esc(label)}</span>`;
          list.appendChild(item);
        }
      }
    }
    syncAccessTabs(); dependencies.applyTranslations(section);
  }
  function renderSeverity(model: DashboardModel): void {
    const valid = model.responses.vulnerabilities !== null;
    for (const severity of severities) {
      if (valid) text(`dashboard-severity-${severity}`, String(model.severity[severity] ?? 0));
      text(`dashboard-severity-${severity}-pct`, valid ? `${model.severityTotal > 0 ? Math.round((model.severity[severity] ?? 0) / model.severityTotal * 100) : 0}%` : '-');
    }
    charts.renderDonut(valid ? model.severity : {}, valid ? model.severityTotal : 0);
    if (!valid) text('dashboard-severity-total', '-');
    const resolution = model.resolution;
    for (const key of ['open', 'confirmed', 'fixed', 'fp', 'ignored'] as const) text(`dashboard-status-${key}`, formatNumber(resolution[key]));
    text('dashboard-fix-rate', resolution.actionable > 0 ? `${resolution.rate.toFixed(resolution.rate >= 100 ? 0 : 1)}%` : '-');
    text('dashboard-fix-detail', `(${formatNumber(resolution.fixed)} / ${formatNumber(resolution.actionable)})`);
    progress('dashboard-fix-progress-fixed', Number(resolution.rate.toFixed(2)));
    progress('dashboard-fix-progress-confirmed', resolution.actionable > 0 ? Number((resolution.confirmed / resolution.actionable * 100).toFixed(2)) : 0);
    const { score, level } = model.risk;
    document.querySelector('.dashboard-severity-insight-risk')?.setAttribute('data-level', level);
    const names = { safe: ['riskSafe', 'Safe'], low: ['riskLow', 'Low'], medium: ['riskMedium', 'Medium'], high: ['riskHigh', 'High'], severe: ['riskSevere', 'Critical'] } as const;
    const [key, fallback] = names[level]; text('dashboard-severity-risk-level', t(`dashboard.${key}`, null, fallback));
    progress('dashboard-severity-risk-fill', Number(score.toFixed(1)));
    const displayScore = Math.round(score) === score ? String(score) : score.toFixed(1);
    text('dashboard-severity-risk-score', score >= 100 ? `${displayScore}+` : displayScore);
    for (const severity of ['critical', 'high']) {
      const node = el(`dashboard-severity-urgent-${severity}`); const count = model.open[severity] ?? 0;
      if (node) { node.textContent = formatNumber(count); node.closest('.dashboard-severity-insight-urgent-item')?.classList.toggle('is-zero', count === 0); }
    }
    const latest = el('dashboard-severity-latest-time');
    if (latest) {
      const time = valid ? timeAgo(model.responses.recentVulnerabilities?.vulnerabilities?.[0]?.created_at) : '';
      latest.textContent = time || t('dashboard.noneYet', null, 'None yet'); latest.classList.toggle('is-empty', !time);
    }
  }
  function renderTokens(model: DashboardModel): void {
    const summary = model.responses.tokens?.summary;
    if (!summary) { text('dashboard-kpi-token-usage', '-'); sub('dashboard-kpi-token-sub-text', '-'); return; }
    const total = Number(summary.totalTokens || 0);
    if (!Number.isFinite(total) || total <= 0) {
      text('dashboard-kpi-token-usage', '0'); sub('dashboard-kpi-token-sub-text', t('dashboard.noTokenUsageYet', null, 'No usage yet')); return;
    }
    const input = Number.isFinite(summary.promptTokens) && summary.promptTokens > 0 ? Math.trunc(summary.promptTokens) : 0;
    const cached = Number.isFinite(summary.cachedTokens) && summary.cachedTokens > 0 ? Math.trunc(summary.cachedTokens) : 0;
    const rate = input > 0 ? `${(Math.min(cached, input) / input * 100).toFixed(1)}%` : '—';
    text('dashboard-kpi-token-usage', formatTokenUsageCompact(total)); sub('dashboard-kpi-token-sub-text', t('dashboard.tokenUsageSub', { rate }, `Cache hit ${rate}`));
  }
  function render(model: DashboardModel): void {
    const r = model.responses;
    text('dashboard-running-tasks', model.running !== null ? String(model.running) : '-');
    sub('dashboard-kpi-tasks-sub-text', (model.running ?? 0) === 0 ? t('dashboard.allIdle', null, 'System idle') : t('dashboard.executingNow', null, 'Running'), (model.running ?? 0) === 0 ? 'idle' : 'running');
    text('dashboard-vuln-total', r.vulnerabilities ? String(r.vulnerabilities.total) : '-');
    renderSeverity(model);
    if (r.vulnerabilities) {
      const critical = model.open.critical ?? 0, high = model.open.high ?? 0, total = r.vulnerabilities.total;
      text('dashboard-kpi-vuln-critical-count', String(critical)); hidden('dashboard-kpi-vuln-critical-badge', critical === 0);
      text('dashboard-kpi-vuln-sub-text', total === 0 ? t('dashboard.allClear', null, 'No new risks') : critical === 0 && high === 0 ? t('dashboard.allHandled', null, 'All high severity handled') : high > 0 ? t('dashboard.openHighCountLabel', { count: high }, `${high} high severity open`) : t('dashboard.totalCount', { count: total }, `${total} total`));
    } else { hidden('dashboard-kpi-vuln-critical-badge', true); sub('dashboard-kpi-vuln-sub-text', '-'); }
    for (const key of ['pending', 'running', 'done'] as const) {
      text(`dashboard-batch-${key}`, model.batch ? String(model.batch[key]) : '-');
      progress(`dashboard-batch-progress-${key}`, model.batch?.total ? Number((model.batch[key] / model.batch.total * 100).toFixed(1)) : 0);
    }
    text('dashboard-batch-total', model.batch ? model.batch.total > 0 ? t('dashboard.totalCount', { count: model.batch.total }, `${model.batch.total} total`) : t('dashboard.noTasks', null, 'No tasks') : '-');
    if (r.monitor?.summary) {
      text('dashboard-kpi-tools-calls', formatNumber(model.totalCalls)); sub('dashboard-kpi-tools-sub-text', t('dashboard.toolsCountLabel', { count: model.toolCount }, `${model.toolCount} tools`));
      if (model.successRate >= 0) {
        text('dashboard-kpi-success-rate', `${model.successRate.toFixed(1)}%`);
        const failed = model.failedTools > 0 ? ` · ${t('dashboard.failedNCalls', { count: model.failedTools }, `${model.failedTools} failed`)}` : '';
        if (model.successRate >= 95) sub('dashboard-kpi-rate-sub-text', t('dashboard.healthyStatus', null, 'Healthy'), 'success');
        else if (model.successRate >= 80) sub('dashboard-kpi-rate-sub-text', t('dashboard.normalStatus', null, 'Mostly OK') + failed, 'warning');
        else sub('dashboard-kpi-rate-sub-text', t('dashboard.degradedStatus', null, 'Needs attention') + failed, 'danger');
      } else {
        text('dashboard-kpi-success-rate', '-'); sub('dashboard-kpi-rate-sub-text', model.totalCalls > 0 ? t('dashboard.noCompletedYet', null, 'No completed outcomes yet') : t('dashboard.noCallYet', null, 'No calls yet'));
      }
    } else {
      text('dashboard-kpi-tools-calls', '-'); text('dashboard-kpi-success-rate', '-'); sub('dashboard-kpi-tools-sub-text', '-'); sub('dashboard-kpi-rate-sub-text', '-');
    }
    charts.renderTools(r.monitor?.topTools); renderTokens(model);
    text('dashboard-resource-tools', r.tools ? formatNumber(r.tools.total) : model.toolCount > 0 ? formatNumber(model.toolCount) : '-');
    text('dashboard-resource-knowledge', r.knowledge ? r.knowledge.enabled === false ? t('dashboard.notEnabled', null, 'Disabled') : formatNumber(r.knowledge.total_items ?? 0) : '-');
    text('dashboard-resource-skills', r.skills ? formatNumber(r.skills.total_skills ?? 0) : '-');
    text('dashboard-resource-roles', r.roles ? formatNumber((Array.isArray(r.roles) ? r.roles : r.roles.roles ?? []).length) : '-');
    text('dashboard-resource-agents', r.agents ? formatNumber((Array.isArray(r.agents) ? r.agents : r.agents.agents ?? []).length) : '-');
    feeds.renderVulnerabilities(r.recentVulnerabilities); feeds.renderFacts(r.projects); feeds.renderEvents(model);
    alerts.renderHealth(r.externalMcp); renderAccess(model); alerts.renderBanner(model); alerts.renderRecommendations(model.recommendation);
    hidden('dashboard-cta-block', Object.values(model.resources).some(value => value > 0));
    const date = new Date(model.updatedAt), pad = (value: number): string => String(value).padStart(2, '0');
    text('dashboard-last-updated-time', `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
    const wrap = el('dashboard-last-updated'); if (wrap) { wrap.classList.remove('is-stale', 'is-flash'); void wrap.offsetWidth; wrap.classList.add('is-flash'); }
    hidden('dashboard-last-updated-stale', true);
  }
  function overviewPlaceholder(value: string): void {
    for (const key of ['pending', 'running', 'done', 'total']) text(`dashboard-batch-${key}`, value);
    for (const key of ['pending', 'running', 'done']) progress(`dashboard-batch-progress-${key}`, 0);
  }
  function loading(): void {
    text('dashboard-running-tasks', '…'); text('dashboard-vuln-total', '…'); text('dashboard-severity-total', '0');
    for (const severity of severities) { text(`dashboard-severity-${severity}`, '0'); text(`dashboard-severity-${severity}-pct`, '0%'); }
    charts.renderDonut({}, 0); overviewPlaceholder('…');
    for (const key of ['tools-calls', 'success-rate', 'token-usage']) text(`dashboard-kpi-${key}`, '…');
    for (const key of ['tasks', 'vuln', 'tools', 'rate', 'token']) sub(`dashboard-kpi-${key}-sub-text`, '…');
    hidden('dashboard-kpi-vuln-critical-badge', true); hidden('dashboard-alert-banner', true);
    feeds.placeholder('vulns'); feeds.placeholder('facts');
    for (const key of ['tools', 'skills', 'knowledge', 'roles', 'agents']) text(`dashboard-resource-${key}`, '…');
    for (const id of ['dashboard-webshell-connections', 'dashboard-c2-listeners-running', 'dashboard-c2-sessions-online', 'dashboard-c2-tasks-pending']) text(id, '…');
    const placeholder = el('dashboard-tools-pie-placeholder'); if (placeholder) { placeholder.style.removeProperty('display'); placeholder.textContent = t('common.loading', null, 'Loading…'); }
    const bars = el('dashboard-tools-bar-chart'); if (bars) { bars.style.display = 'none'; bars.innerHTML = ''; }
    for (const key of ['open', 'confirmed', 'fixed', 'fp', 'ignored']) text(`dashboard-status-${key}`, '0');
    text('dashboard-fix-rate', '-'); text('dashboard-fix-detail', '(0 / 0)'); progress('dashboard-fix-progress-fixed', 0); progress('dashboard-fix-progress-confirmed', 0);
    document.querySelector('.dashboard-severity-insight-risk')?.setAttribute('data-level', 'safe');
    text('dashboard-severity-risk-level', t('dashboard.riskSafe', null, 'Safe')); text('dashboard-severity-risk-score', '0'); progress('dashboard-severity-risk-fill', 0);
    for (const severity of ['critical', 'high']) { const node = el(`dashboard-severity-urgent-${severity}`); if (node) { node.textContent = '0'; node.closest('.dashboard-severity-insight-urgent-item')?.classList.add('is-zero'); } }
    const latest = el('dashboard-severity-latest-time'); if (latest) { latest.textContent = t('dashboard.noneYet', null, 'None yet'); latest.classList.add('is-empty'); }
  }
  function error(cause: unknown): void {
    console.warn('Failed to fetch dashboard stats', cause);
    text('dashboard-running-tasks', '-'); text('dashboard-vuln-total', '-'); overviewPlaceholder('-');
    for (const key of ['success-rate', 'tools-calls', 'token-usage']) text(`dashboard-kpi-${key}`, '-');
    for (const key of ['tasks', 'vuln', 'tools', 'rate', 'token']) sub(`dashboard-kpi-${key}-sub-text`, '-');
    for (const key of ['tools', 'skills', 'knowledge', 'roles', 'agents']) text(`dashboard-resource-${key}`, '-');
    hidden('dashboard-section-access', true); feeds.placeholder('vulns', true); feeds.placeholder('facts', true); charts.renderTools(null);
  }
  function syncFilter(status: SeverityStatus): void {
    el('dashboard-severity-status-filter')?.setAttribute('data-value', status);
    text('dashboard-severity-status-filter-text', status ? dom.statusLabel(status) : t('dashboard.allStatuses', null, 'All statuses'));
    root?.querySelectorAll('.dashboard-severity-status-filter-option[data-status]').forEach(item => {
      const active = item.getAttribute('data-status') === status; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active));
    });
  }
  function closeFilterMenu(): void {
    el('dashboard-severity-status-filter-menu')?.setAttribute('hidden', ''); el('dashboard-severity-status-filter')?.classList.remove('is-open'); el('dashboard-severity-status-filter-btn')?.setAttribute('aria-expanded', 'false');
  }
  function toggleFilterMenu(): void {
    if (service) syncFilter(service.getStatus());
    const menu = el('dashboard-severity-status-filter-menu'); if (!menu) return;
    const open = menu.hasAttribute('hidden'); menu.toggleAttribute('hidden', !open);
    el('dashboard-severity-status-filter')?.classList.toggle('is-open', open); el('dashboard-severity-status-filter-btn')?.setAttribute('aria-expanded', String(open));
  }
  function openProjectFact(projectId: string, key: string): void {
    if (!projectId) return;
    dependencies.navigate('projects');
    later(() => { void (async () => { await dependencies.initProjects(); await dependencies.selectProject(projectId); dependencies.switchProjectTab('facts'); if (key) dependencies.viewProjectFact(key); })().catch(cause => console.warn('dashboard project navigation failed', cause)); });
  }
  function bind(next: DashboardService): void {
    service = next;
    const close = el('dashboard-alert-close'); if (close) close.dataset.action = 'dismiss-alert';
    // Donut/legend keyboard handling is local to charts and must not fire twice.
    const activate = (node: HTMLElement, event: Event): void => {
      switch (node.dataset.action) {
        case 'navigate': dependencies.navigate(node.dataset.page ?? 'dashboard'); break;
        case 'refresh': void next.refresh(); break;
        case 'token-usage': dependencies.openTokenUsage(); break;
        case 'notifications': dependencies.openNotifications(); break;
        case 'filter-menu': event.preventDefault(); event.stopPropagation(); toggleFilterMenu(); break;
        case 'filter-status': event.preventDefault(); event.stopPropagation(); closeFilterMenu(); void next.updateStatus(node.dataset.status ?? ''); break;
        case 'vuln-status': navigateVulnerabilities({ status: normalizeStatus(node.dataset.status ?? '') }); break;
        case 'severity-all': navigateVulnerabilities({ status: next.getStatus() }); break;
        case 'feed-tab': switchFeedTab(node.dataset.tab ?? 'vulns'); break;
        case 'access-tab': switchAccessTab(node.dataset.tab ?? 'c2'); break;
        case 'dismiss-alert': event.preventDefault(); next.dismissAlert(); break;
        case 'project-fact': openProjectFact(node.dataset.projectId ?? '', node.dataset.factKey ?? ''); break;
        case 'new-project': dependencies.navigate('projects'); later(() => dependencies.showNewProjectModal()); break;
      }
    };
    root?.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
      if (target && root.contains(target)) activate(target, event);
    }, { signal: listeners.signal });
    root?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
      if (!target || target.dataset.action === 'severity' || target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
      event.preventDefault(); activate(target, event);
    }, { signal: listeners.signal });
    document.addEventListener('click', event => { if (!(event.target instanceof Node) || !el('dashboard-severity-status-filter')?.contains(event.target)) closeFilterMenu(); }, { signal: listeners.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFilterMenu(); }, { signal: listeners.signal });
    document.addEventListener('languagechange', () => next.languageChanged(), { signal: listeners.signal });
    document.addEventListener('visibilitychange', () => next.visibilityChanged(), { signal: listeners.signal });
    syncFilter(next.getStatus()); switchFeedTab(next.getFeedTab()); switchAccessTab(next.getAccessTab());
  }
  const observer: DashboardObserver = {
    loading, render, error, filter: syncFilter,
    stale(value) { el('dashboard-last-updated')?.classList.toggle('is-stale', value); hidden('dashboard-last-updated-stale', !value); },
    alertDismissed() { hidden('dashboard-alert-banner', true); },
  };
  return {
    observer, bind, switchFeedTab, switchAccessTab, syncAccessTabs, navigateVulnerabilities, openProjectFact,
    dispose(): void { listeners.abort(); charts.dispose(); for (const id of deferred) browser.cancelLater(id); deferred.clear(); },
  };
}
