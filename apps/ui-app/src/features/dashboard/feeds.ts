import { esc, navigateAction, type DashboardDom } from './dom';
import type { DashboardModel, FeedTab, ProjectSummary, VulnerabilityList } from './types';

export function createDashboardFeeds(dom: DashboardDom) {
  const { document, el, hidden, t, timeAgo, severityLabel, statusKey, statusLabel } = dom;
  function clear(selector: string, root: HTMLElement): void { root.querySelectorAll(selector).forEach(node => node.remove()); }
  function placeholder(kind: 'vulns' | 'facts', error = false): void {
    const root = el(`dashboard-recent-${kind}`); if (!root) return;
    clear(kind === 'vulns' ? '.dashboard-recent-vuln-item' : '.dashboard-recent-fact-item, .dashboard-recent-facts-meta', root);
    const empty = el(`dashboard-recent-${kind}-empty`);
    if (empty) { empty.hidden = false; empty.classList.remove('is-rich'); empty.textContent = error ? t('common.loadFailed', null, 'Load failed') : t('common.loading', null, 'Loading…'); }
  }
  function renderVulnerabilities(response: VulnerabilityList | null): void {
    const root = el('dashboard-recent-vulns'), empty = el('dashboard-recent-vulns-empty'); if (!root) return;
    clear('.dashboard-recent-vuln-item', root);
    const list = response?.vulnerabilities ?? [];
    if (!list.length) {
      if (empty) {
        empty.hidden = false; empty.classList.add('is-rich');
        empty.innerHTML = `<div class="dashboard-empty-title">${esc(t('dashboard.noVulnYet', null, 'No recent vulnerabilities'))}</div><div class="dashboard-empty-desc">${esc(t('dashboard.noVulnDesc', null, 'This list shows recent records; new results appear here when detection completes in chat'))}</div><button type="button" class="dashboard-empty-action" data-action="navigate" data-page="chat">${esc(t('dashboard.startScanBtn', null, 'Go to chat to scan'))} →</button>`;
      }
      return;
    }
    if (empty) { empty.hidden = true; empty.classList.remove('is-rich'); }
    for (const vulnerability of list.slice(0, 10)) {
      const severity = (vulnerability.severity || 'info').toLowerCase();
      const status = (vulnerability.status || 'open').toLowerCase();
      const item = document.createElement('a'); item.className = 'dashboard-recent-vuln-item'; item.setAttribute('role', 'button'); item.tabIndex = 0;
      navigateAction(item, 'vulnerabilities');
      item.innerHTML = `<span class="dashboard-recent-vuln-sev sev-${esc(severity)}">${esc(severityLabel(severity))}</span>` +
        `<span class="dashboard-recent-vuln-title" title="${esc(vulnerability.title || '')}">${esc(vulnerability.title || t('common.untitled', null, 'Untitled'))}</span>` +
        (vulnerability.target ? `<span class="dashboard-recent-vuln-target" title="${esc(vulnerability.target)}">${esc(vulnerability.target)}</span>` : '<span class="dashboard-recent-vuln-target"></span>') +
        `<span class="dashboard-recent-vuln-status st-${esc(statusKey(status))}"><span class="dashboard-recent-vuln-status-dot"></span>${esc(statusLabel(status))}</span><span class="dashboard-recent-vuln-time">${esc(timeAgo(vulnerability.created_at))}</span>`;
      root.appendChild(item);
    }
  }
  function projectTone(id: string, name: string): number {
    const key = (id || name || '').trim(); let hash = 0;
    for (let i = 0; i < key.length; i++) { hash = ((hash << 5) - hash) + key.charCodeAt(i); hash |= 0; }
    return Math.abs(hash) % 8;
  }
  function renderFacts(response: ProjectSummary | null): void {
    const root = el('dashboard-recent-facts'), empty = el('dashboard-recent-facts-empty'); if (!root) return;
    clear('.dashboard-recent-fact-item, .dashboard-recent-facts-meta', root);
    const list = response?.recent_facts ?? [];
    const activeProjects = response?.totals?.active_projects ?? 0;
    if (!list.length) {
      if (empty) {
        empty.hidden = false; empty.classList.add('is-rich');
        const description = activeProjects > 0 ? t('dashboard.noFactsDesc', null, 'In project-bound chats, the agent records targets, findings, and attack chains') : t('projects.selectOrCreateHint', null, 'Projects share a cross-chat fact board; target, environment, auth and other facts are auto-injected in bound conversations.');
        const label = activeProjects > 0 ? t('dashboard.goToChat', null, 'Go to chat') : t('dashboard.createFirstProjectBtn', null, 'Create first project');
        empty.innerHTML = `<div class="dashboard-empty-title">${esc(t('dashboard.noFactsYet', null, 'No recent facts'))}</div><div class="dashboard-empty-desc">${esc(description)}</div><button type="button" class="dashboard-empty-action" data-action="${activeProjects > 0 ? 'navigate' : 'new-project'}"${activeProjects > 0 ? ' data-page="chat"' : ''}>${esc(label)} →</button>`;
      }
      return;
    }
    if (empty) { empty.hidden = true; empty.classList.remove('is-rich'); }
    for (const fact of list.slice(0, 10)) {
      const category = fact.category?.trim() || 'note';
      const confidence = (fact.confidence || 'tentative').toLowerCase();
      const confidenceLabel = confidence === 'confirmed' ? t('projects.confidenceConfirmed', null, 'Confirmed') : confidence === 'tentative' ? t('projects.confidenceTentative', null, 'Tentative') : confidence || '—';
      const project = fact.project_name?.trim() || t('projects.defaultProjectName', null, 'Project');
      const key = fact.fact_key?.trim() || '—';
      const item = document.createElement('a'); item.className = 'dashboard-recent-fact-item'; item.setAttribute('role', 'button'); item.tabIndex = 0;
      item.dataset.action = 'project-fact'; item.dataset.projectId = fact.project_id || ''; item.dataset.factKey = fact.fact_key || '';
      item.innerHTML = `<span class="dashboard-recent-fact-pin${fact.pinned ? ' is-pinned' : ''}"${fact.pinned ? ` title="${esc(t('projects.pinned', null, 'Pinned'))}"` : ''} aria-hidden="true">${fact.pinned ? '📌' : ''}</span>` +
        `<span class="dashboard-recent-fact-cat cat-${esc(category.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}">${esc(category)}</span>` +
        `<span class="dashboard-recent-fact-conf conf-${esc(confidence)}">${esc(confidenceLabel)}</span>` +
        `<span class="dashboard-recent-fact-summary" title="${esc(fact.summary || '')}">${esc(fact.summary || t('common.untitled', null, 'Untitled'))}</span>` +
        `<span class="dashboard-recent-fact-key" title="${esc(key)}">${esc(key)}</span>` +
        `<span class="dashboard-recent-fact-project proj-tone-${projectTone(fact.project_id, project)}" title="${esc(project)}">${esc(project)}</span>` +
        `<span class="dashboard-recent-fact-time">${esc(timeAgo(fact.updated_at))}</span>`;
      root.appendChild(item);
    }
  }
  function switchTab(tab: FeedTab): void {
    for (const value of ['vulns', 'facts'] as const) {
      const node = el(`dashboard-feed-tab-${value}`); node?.classList.toggle('is-active', tab === value); node?.setAttribute('aria-selected', String(tab === value));
      hidden(`dashboard-feed-panel-${value}`, tab !== value);
    }
    const link = el('dashboard-feed-view-all'); if (link) navigateAction(link, tab === 'facts' ? 'projects' : 'vulnerabilities');
  }
  function renderEvents(model: DashboardModel): void {
    const root = el('dashboard-events-list'); if (!root) return;
    hidden('dashboard-section-events', !model.events.length);
    root.innerHTML = model.events.map(item => {
      const title = esc(item.title || t('dashboard.eventUntitled', null, 'Event'));
      const message = esc(item.desc || '');
      return `<div class="dashboard-event-item lvl-${esc(item.level || 'p2')}"><span class="dashboard-event-dot" aria-hidden="true"></span><div class="dashboard-event-body"><div class="dashboard-event-title">${title}</div>${message && message !== title ? `<div class="dashboard-event-msg">${message}</div>` : ''}</div><span class="dashboard-event-time">${esc(timeAgo(item.ts) || '—')}</span></div>`;
    }).join('');
  }
  return { placeholder, renderVulnerabilities, renderFacts, switchTab, renderEvents };
}
