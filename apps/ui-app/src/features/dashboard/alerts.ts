import { esc, formatNumber, navigateAction, type DashboardDom } from './dom';
import type { DashboardModel, ExternalMcpStats, RecommendationStats } from './types';

const svg = (paths: string, rounded = false): string => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"${rounded ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}>${paths}</svg>`;
export function createDashboardAlerts(dom: DashboardDom) {
  const { document, el, hidden, t } = dom;
  function renderHealth(stats: ExternalMcpStats | null): void {
    const row = el('dashboard-resource-external-mcp-row'), text = el('dashboard-resource-external-mcp-text'), health = el('dashboard-resource-external-mcp-health');
    if (!row || !text) return;
    if (!stats || !stats.total || !stats.enabled) { row.hidden = true; return; }
    const down = Math.max(0, stats.enabled - stats.connected);
    row.hidden = false; text.textContent = `${formatNumber(stats.connected)} / ${formatNumber(stats.enabled)}`;
    if (health) {
      health.classList.remove('is-ok', 'is-warning', 'is-danger'); health.hidden = false;
      if (!down) { health.classList.add('is-ok'); health.textContent = t('dashboard.mcpAllRunning', null, 'All running'); }
      else if (down < stats.enabled) { health.classList.add('is-warning'); health.textContent = t('dashboard.mcpPartialDown', { count: down }, `${down} not running`); }
      else { health.classList.add('is-danger'); health.textContent = t('dashboard.mcpAllDown', null, 'All stopped'); }
    }
  }
  function renderBanner(model: DashboardModel): void {
    const banner = el('dashboard-alert-banner'), title = el('dashboard-alert-title'), description = el('dashboard-alert-desc'), actions = el('dashboard-alert-actions');
    if (!banner || !title || !description || !actions) return;
    banner.hidden = !model.alert.visible;
    if (!model.alert.keys.length) { banner.classList.remove('is-warning', 'is-danger', 'is-info'); return; }
    if (!model.alert.visible) return;
    const stats = model.alertStats;
    const reasons: string[] = [];
    if (stats.criticalCount > 0) reasons.push(t('dashboard.alertCriticalReason', { count: stats.criticalCount }, `${stats.criticalCount} critical vulnerabilities await action; handle them now`));
    if (stats.hitlPending > 0) reasons.push(t('dashboard.alertHitlReason', { count: stats.hitlPending }, `${stats.hitlPending} HITL requests await approval; the agent is waiting for your decision`));
    if (stats.successRate >= 0 && stats.successRate < 80 && stats.failedTools > 0) reasons.push(t('dashboard.alertFailedReason', { count: stats.failedTools }, `Tool call success rate is low (${stats.failedTools} failures); check MCP monitoring`));
    if (stats.externalMcpDown > 0) reasons.push(t('dashboard.alertMcpDownReason', { count: stats.externalMcpDown }, `${stats.externalMcpDown} external MCP servers are not running; related tools are unavailable`));
    banner.classList.remove('is-warning', 'is-danger', 'is-info'); banner.classList.add(`is-${model.alert.level}`);
    title.textContent = model.alert.level === 'danger' ? t('dashboard.alertDangerTitle', null, 'Action required') : model.alert.level === 'warning' ? t('dashboard.alertWarningTitle', null, 'Needs attention') : t('dashboard.alertTitle', null, 'Heads up');
    description.textContent = reasons.join('; '); actions.innerHTML = '';
    const button = (key: string, fallback: string, page: string, secondary = true): void => {
      const node = document.createElement('button'); node.className = `dashboard-alert-btn${secondary ? ' dashboard-alert-btn-secondary' : ''}`;
      node.textContent = t(key, null, fallback); navigateAction(node, page); actions.appendChild(node);
    };
    if (stats.criticalCount > 0) button('dashboard.viewVulns', 'View vulnerabilities', 'vulnerabilities', false);
    if (stats.hitlPending > 0) button('dashboard.viewHitl', 'Approve', 'hitl');
    if (stats.successRate >= 0 && stats.successRate < 80) button('dashboard.viewMonitor', 'View monitor', 'mcp-monitor');
    if (stats.externalMcpDown > 0) button('dashboard.viewMcpManagement', 'Manage MCP', 'mcp-management');
  }
  function renderRecommendations(state: RecommendationStats): void {
    const list = el('dashboard-recommend-list'); if (!list) return;
    const actions: { level: string; icon: string; title: string; desc: string; page: string }[] = [];
    if (state.openCriticalCount > 0) actions.push({
      level: 'urgent', icon: svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>', true),
      title: t('dashboard.recoFixCritical', { count: state.openCriticalCount }, `Fix ${state.openCriticalCount} open critical vulnerabilities`),
      desc: t('dashboard.recoFixCriticalDesc', null, 'Critical-level vulnerabilities should be addressed first'), page: 'vulnerabilities',
    });
    if (state.hitlPending > 0) actions.push({
      level: 'urgent', icon: svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
      title: t('dashboard.recoApproveHitl', { count: state.hitlPending }, `Review ${state.hitlPending} HITL requests`),
      desc: t('dashboard.recoApproveHitlDesc', null, 'Agent needs your decision to proceed'), page: 'hitl',
    });
    if (state.externalMcpDown > 0) actions.push({
      level: 'warning', icon: svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"/>'),
      title: t('dashboard.recoRestartMcp', { count: state.externalMcpDown }, `Check ${state.externalMcpDown} external MCP servers that are down`),
      desc: t('dashboard.recoRestartMcpDesc', null, 'Related tools are unavailable until MCP recovers'), page: 'mcp-management',
    });
    if (state.successRate >= 0 && state.successRate < 80 && state.failedTools > 0) actions.push({
      level: 'warning', icon: svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
      title: t('dashboard.recoCheckMonitor', { count: state.failedTools }, `Investigate ${state.failedTools} failed tool calls`),
      desc: t('dashboard.recoCheckMonitorDesc', null, 'View failed request details in MCP monitor'), page: 'mcp-monitor',
    });
    if (!state.toolsConfigured) actions.push({
      level: 'setup', icon: svg('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
      title: t('dashboard.recoSetupMcp', null, 'Configure your first MCP tool'), desc: t('dashboard.recoSetupMcpDesc', null, 'Install MCP server before Agent can invoke specific capabilities'), page: 'mcp-management',
    });
    if (!state.totalVulns && !state.totalRunning && state.toolsConfigured > 0) actions.push({
      level: 'setup', icon: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      title: t('dashboard.recoStartScan', null, 'Start a scan from chat'), desc: t('dashboard.recoStartScanDesc', null, 'Describe your target in chat, AI will help execute'), page: 'chat',
    });
    hidden('dashboard-section-recommend', !actions.length);
    list.innerHTML = actions.slice(0, 5).map(action => `<a class="dashboard-recommend-item lvl-${action.level}" data-action="navigate" data-page="${esc(action.page)}" role="button" tabindex="0"><span class="dashboard-recommend-icon" aria-hidden="true">${action.icon}</span><div class="dashboard-recommend-body"><div class="dashboard-recommend-title">${esc(action.title)}</div><div class="dashboard-recommend-desc">${esc(action.desc)}</div></div><span class="dashboard-recommend-arrow" aria-hidden="true">→</span></a>`).join('');
  }
  return { renderHealth, renderBanner, renderRecommendations };
}
