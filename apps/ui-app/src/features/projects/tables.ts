import { projectsBrowser as browser } from '../../platform/projects-browser';
import type { ProjectsContext } from './context';
import { esc, formatProjectTime } from './dom';
import { isSparseFactBody, requiresAttackChainFact } from './fact-body';

export function createProjectTables(ctx: ProjectsContext) {
  const { service, deps, dom } = ctx, { t, fmt, button } = dom;
  let factsSequence = 0, conversationsSequence = 0, vulnerabilitiesSequence = 0, statsSequence = 0;
  function confidenceBadge(confidence: string) {
    const c = confidence.toLowerCase(), label = ['confirmed', 'deprecated', 'tentative'].includes(c) ? t(`projects.confidence${c.charAt(0).toUpperCase() + c.slice(1)}`) : c || '—';
    return `<span class="projects-confidence projects-confidence--${c === 'confirmed' || c === 'deprecated' ? c : 'tentative'}">${esc(label)}</span>`;
  }
  async function refreshProjectHeaderStats() {
    const id = service.state.selectedId, seq = ++statsSequence; if (!id) return;
    const stats = await service.api.stats(id); if (seq !== statsSequence || id !== service.state.selectedId) return;
    const record = stats as typeof stats & { factCount?: number; vulnCount?: number; conversationCount?: number; sparseFactCount?: number };
    for (const [field, key, count, fallback] of [
      ['facts', 'statsFacts', record.fact_count ?? record.factCount ?? 0, 'facts'], ['vulns', 'statsVulns', record.vuln_count ?? record.vulnCount ?? 0, 'vulnerabilities'],
      ['conversations', 'statsConversations', record.conversation_count ?? record.conversationCount ?? 0, 'conversations'], ['sparse', 'statsSparse', record.sparse_fact_count ?? record.sparseFactCount ?? 0, 'to complete'],
    ] as const) { dom.text(`project-stat-${field}`, fmt(`projects.${key}`, `${count} ${fallback}`, { count })); if (field === 'sparse') dom.hidden('project-stat-sparse', count <= 0); }
  }
  async function loadProjectFacts() {
    const id = service.state.selectedId, seq = ++factsSequence; if (!id || !dom.el('project-facts-tbody')) return;
    dom.empty('project-facts-tbody', 8, 'common.loading');
    const query: Record<string, string | boolean | number> = { limit: 200, include_link_counts: true };
    for (const [field, key] of [['search', 'search'], ['filter-category', 'category'], ['filter-confidence', 'confidence']] as const) { const value = dom.value(`project-facts-${field}`).trim(); if (value) query[key] = value; }
    if (dom.checked('project-facts-filter-sparse')) query.sparse_only = true;
    if (dom.checked('project-facts-filter-hide-deprecated')) query.exclude_deprecated = true;
    try {
      const facts = await service.api.facts(id, query); if (seq !== factsSequence || id !== service.state.selectedId) return;
      if (!facts.length) { dom.empty('project-facts-tbody', 8, query.search || query.category || query.confidence || query.sparse_only ? 'projects.noMatchingFacts' : 'projects.noFacts'); }
      else dom.html('project-facts-tbody', facts.map(fact => {
        const category = fact.category.trim().toLowerCase() || 'note', categoryClass = ['target', 'auth', 'infra', 'business', 'finding', 'chain', 'exploit', 'poc', 'note', 'vuln'].includes(category) ? category === 'vuln' ? 'exploit' : category : 'custom';
        const sparse = isSparseFactBody(fact.category, fact.fact_key, fact.body), attack = requiresAttackChainFact(fact.category, fact.fact_key);
        const badge = `<span class="projects-fact-badge projects-fact-badge--${attack ? sparse ? 'warn' : 'ok' : 'na'}" title="${esc(t(attack ? sparse ? 'projects.factBodySparseTitle' : 'projects.factBodyReproducibleTitle' : 'projects.factBodyEnvTitle'))}">${esc(attack ? t(sparse ? 'projects.factBodySparse' : 'projects.factBodyReproducible') : fact.body.trim() ? t('projects.factBodyHasDetail') : '—')}</span>`;
        const pin = fact.pinned ? `<span class="projects-list-item-badge" title="${esc(t('projects.pinned'))}">${esc(t('projects.pinned'))}</span>` : '';
        const vuln = fact.related_vulnerability_id ? `<span class="projects-fact-vuln-link" title="${esc(t('projects.relatedVulnIdTitle') + ': ' + fact.related_vulnerability_id)}">${esc(t('projects.relatedVulnIdTitle'))}: ${esc(fact.related_vulnerability_id.slice(0, 8))}…</span>` : '';
        const links = fact.link_counts;
        const linkBadge = links?.incoming || links?.outgoing ? `<span class="projects-fact-link-badge" title="${esc(t('projects.linkCountsTitle'))}">↑${links.outgoing || 0} ↓${links.incoming || 0}</span>` : '<span class="projects-fact-link-badge projects-fact-link-badge--empty">—</span>';
        const keyData = `data-key="${esc(fact.fact_key)}"`;
        return `<tr><td class="cell-fact-key"><code class="projects-fact-key-chip" title="${esc(fact.fact_key)}">${esc(fact.fact_key)}</code>${pin || vuln ? `<div class="projects-fact-meta">${pin}${vuln}</div>` : ''}</td><td class="cell-fact-category"><span class="projects-category projects-category--${categoryClass}">${esc(fact.category || '—')}</span></td><td class="cell-summary" title="${esc(fact.summary)}">${esc(fact.summary)}</td><td class="cell-fact-links">${linkBadge}</td><td>${badge}</td><td>${confidenceBadge(fact.confidence)}</td><td>${esc(formatProjectTime(t, fact.updated_at, fact.created_at))}</td><td class="col-actions"><div class="projects-table-actions">${button('edit-fact', t('common.edit'), keyData, 'edit', t('projects.editTitle'))}${button('view-fact', t('projects.details'), keyData, 'view', t('projects.viewBodyTitle'))}${button(fact.confidence.toLowerCase() === 'deprecated' ? 'restore-fact' : 'deprecate-fact', t(fact.confidence.toLowerCase() === 'deprecated' ? 'projects.restore' : 'projects.deprecate'), keyData, fact.confidence.toLowerCase() === 'deprecated' ? 'restore' : 'mute')}${button('delete-fact', t('common.delete'), `data-id="${esc(fact.id)}"`, 'danger', t('projects.deleteForeverTitle'))}</div></td></tr>`;
      }).join(''));
      ctx.run(ctx.refreshStats);
    } catch (error) { if (seq === factsSequence && id === service.state.selectedId) dom.empty('project-facts-tbody', 8, 'common.loadFailed'); throw error; }
  }
  async function deleteProjectFact(id: string) {
    if (!deps.requirePermission('project:write') || !browser.confirm(t('projects.confirmDeleteFact'))) return;
    await service.api.deleteFact(service.state.selectedId, id); await loadProjectFacts(); if (service.state.tab === 'graph') await ctx.refreshGraph();
  }
  async function confidence(key: string, restore: boolean) {
    if (!deps.requirePermission('project:write') || !browser.confirm(t(restore ? 'projects.confirmRestoreFact' : 'projects.confirmDeprecateFact', { factKey: key, interpolation: { escapeValue: false } }))) return;
    await service.api.confidence(service.state.selectedId, key, restore); await loadProjectFacts();
  }
  function openVulnerabilitiesForProject(projectId = service.state.selectedId) { if (!projectId) return; deps.navigate('vulnerabilities'); if (!deps.setVulnerabilityProjectFilter(projectId)) browser.setHash(`vulnerabilities?project_id=${encodeURIComponent(projectId)}`); }
  function openVulnerabilityDetail(id: string) { openVulnerabilitiesForProject(); setTimeout(() => deps.setVulnerabilityIdFilter(id), 300); }
  async function loadProjectVulnerabilities() {
    const id = service.state.selectedId, seq = ++vulnerabilitiesSequence; if (!id || !dom.el('project-vulns-tbody')) return;
    dom.empty('project-vulns-tbody', 4, 'common.loading');
    const query: Record<string, string> = {};
    for (const [field, key] of [['search', 'q'], ['filter-severity', 'severity'], ['filter-status', 'status']] as const) { const value = dom.value(`project-vulns-${field}`).trim(); if (value) query[key] = value; }
    try {
      const items = await service.api.vulnerabilities(id, query); if (seq !== vulnerabilitiesSequence || id !== service.state.selectedId) return;
      if (!items.length) dom.empty('project-vulns-tbody', 4, Object.keys(query).length ? 'projects.noMatchingVulns' : 'projects.noVulnerabilityRecords');
      else dom.html('project-vulns-tbody', items.map(item => {
        const severity = ['critical', 'high', 'medium', 'low', 'info'].includes(item.severity.toLowerCase()) ? item.severity.toLowerCase() : 'info';
        const statuses: Record<string, string> = { open: 'statusOpen', confirmed: 'statusConfirmed', fixed: 'statusFixed', false_positive: 'statusFalsePositive', ignored: 'statusIgnored' };
        return `<tr><td class="cell-summary" title="${esc(item.title)}">${esc(item.title)}</td><td><span class="projects-severity projects-severity--${severity}">${esc(item.severity || '—')}</span></td><td><span class="status-badge status-${statuses[item.status] ? esc(item.status) : 'open'}">${esc(statuses[item.status] ? t(`vulnerabilityPage.${statuses[item.status]}`) : item.status || '—')}</span></td><td class="col-actions"><div class="projects-table-actions">${button('open-vulnerability', t('common.view'), `data-id="${esc(item.id)}"`)}${button('vulnerability-facts', t('projects.facts'), `data-id="${esc(item.id)}"`, 'view', t('projects.viewRelatedFactsTitle'))}</div></td></tr>`;
      }).join(''));
      ctx.run(ctx.refreshStats);
    } catch (error) { if (seq === vulnerabilitiesSequence && id === service.state.selectedId) dom.empty('project-vulns-tbody', 4, 'common.loadFailed'); throw error; }
  }
  async function viewFactsForVulnerability(id: string) {
    const facts = await service.api.facts(service.state.selectedId, { limit: 50, related_vulnerability_id: id });
    if (!facts.length) return browser.alert(t('projects.noFactsForVulnerability'));
    const pick = facts.length === 1 ? '1' : browser.prompt(t('projects.promptChooseFactByIndex', { count: facts.length, lines: facts.map((fact, i) => `${i + 1}. ${fact.fact_key}`).join('\n'), interpolation: { escapeValue: false } }));
    if (pick) { const fact = facts[Number.parseInt(pick, 10) - 1]; if (fact) await ctx.showFact(fact.fact_key); }
  }
  function openProjectConversation(id: string) { if (!id) return; deps.navigate('chat'); setTimeout(() => ctx.run(() => deps.loadConversation(id)), 200); }
  async function loadProjectConversations() {
    const id = service.state.selectedId, seq = ++conversationsSequence; if (!id || !dom.el('project-conversations-tbody')) return;
    dom.empty('project-conversations-tbody', 3, 'common.loading');
    try {
      const data = await service.api.conversations(id); if (seq !== conversationsSequence || id !== service.state.selectedId) return;
      if (!data.conversations.length) return dom.empty('project-conversations-tbody', 3, 'projects.noBoundConversations');
      dom.html('project-conversations-tbody', data.conversations.map(item => `<tr><td class="cell-summary" title="${esc(item.title || t('projects.untitledConversation'))}">${esc(item.title || t('projects.untitledConversation'))}</td><td>${esc(formatProjectTime(t, item.updatedAt || item.updated_at, item.createdAt || item.created_at))}</td><td class="col-actions"><div class="projects-table-actions">${button('open-conversation', t('projects.open'), `data-id="${esc(item.id)}"`)}${button('promote-conversation', t('projects.promoteAttackChain'), `data-id="${esc(item.id)}"`, '', t('projects.promoteAttackChainTitle'))}${button('unbind-conversation', t('projects.unbind'), `data-id="${esc(item.id)}"`, 'mute', t('projects.unbindProjectTitle'))}</div></td></tr>`).join(''));
    } catch (error) { if (seq === conversationsSequence && id === service.state.selectedId) dom.empty('project-conversations-tbody', 3, 'common.loadFailed'); throw error; }
  }
  async function promoteConversationAttackChain(id: string) {
    if (!deps.requirePermission('project:write') || !browser.confirm(t('projects.confirmPromoteAttackChain'))) return;
    const result = await service.api.promote(service.state.selectedId, id);
    deps.notify(fmt('projects.promoteAttackChainSuccess', `${result.facts_created || 0} new / ${result.facts_updated || 0} updated / ${result.edges_created || 0} edges captured`, { ...result }), 'success');
    await loadProjectFacts(); if (service.state.tab === 'graph') await ctx.refreshGraph();
  }
  async function unbindConversationFromProject(id: string) { if (!id || !browser.confirm(t('projects.confirmUnbindConversation'))) return; await service.api.bindConversation(id, ''); await loadProjectConversations(); await ctx.refreshStats(); }
  function renderProjectAssetsPagination() {
    const { assetsPage: page, assetsPageSize: size, assetsTotal: total, assetsTotalPages: pages } = service.state;
    const first = page <= 1 || !total, last = page >= pages || !total;
    const nav = (target: number, key: string, disabled: boolean) => `<button type="button" class="btn-secondary" data-action="projects.assets-page" data-page="${target}" ${disabled ? 'disabled' : ''}>${esc(t(key))}</button>`;
    dom.html('project-assets-pagination', `<div class="pagination"><div class="pagination-info"><span>${esc(fmt('projects.paginationShow', `Showing ${total ? (page - 1) * size + 1 : 0}-${Math.min(page * size, total)} of ${total}`, { start: total ? (page - 1) * size + 1 : 0, end: Math.min(page * size, total), total }))}</span><label class="pagination-page-size">${esc(t('projects.paginationPerPage'))}<select id="project-assets-page-size" data-change="projects.assets-size">${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div><div class="pagination-controls">${nav(1, 'skillsPage.firstPage', first)}${nav(Math.max(1, page - 1), 'projects.paginationPrev', first)}<span class="pagination-page">${esc(fmt('skillsPage.pageOf', `Page ${page} / ${pages}`, { current: page, total: pages }))}</span>${nav(Math.min(pages, page + 1), 'projects.paginationNext', last)}${nav(pages, 'skillsPage.lastPage', last)}</div></div>`);
    const root = dom.el('project-assets-pagination'); if (root) deps.initPaginationSelects(root);
  }
  async function loadProjectAssets(page?: number) {
    if (!service.state.selectedId || !dom.el('project-assets-tbody')) return;
    dom.empty('project-assets-tbody', 7, 'common.loading');
    try {
      if (!await service.loadAssets(page)) return;
      const { assets, assetsTotal } = service.state;
      dom.text('project-assets-count', fmt('projects.assetCount', `${assetsTotal} assets`, { count: assetsTotal }));
      if (!assets.length) dom.empty('project-assets-tbody', 7, 'projects.noBoundAssets');
      else dom.html('project-assets-tbody', assets.map((asset, i) => {
        const target = asset.host || asset.domain || asset.ip || '-', fingerprint = [asset.title, asset.server].filter(Boolean).join(' · ') || '-';
        return `<tr><td class="cell-summary"><button type="button" class="projects-asset-target" data-action="projects.asset-detail" data-index="${i}" title="${esc(target)}">${esc(target)}</button></td><td><code>${esc([asset.protocol, asset.port ? ':' + asset.port : ''].join('') || '-')}</code></td><td class="cell-summary" title="${esc(fingerprint)}">${esc(fingerprint)}</td><td>${esc(asset.source || '-')}</td><td>${esc(asset.last_seen_at ? new Date(asset.last_seen_at).toLocaleString() : '-')}</td><td><span class="asset-status asset-status--${esc(asset.status || 'active')}">${esc(t(asset.status === 'inactive' ? 'assets.statusInactive' : 'assets.statusActive'))}</span></td><td class="col-actions"><div class="projects-table-actions">${button('unbind-asset', t('projects.unbind'), `data-index="${i}" data-require-permission="asset:write"`, 'mute', t('projects.unbindProjectTitle'))}</div></td></tr>`;
      }).join(''));
      renderProjectAssetsPagination(); const wrap = dom.document.querySelector('#project-panel-assets .projects-table-wrap'); if (wrap) wrap.scrollTop = 0;
    } catch (error) { service.state.assets = []; service.state.assetsTotal = 0; service.state.assetsTotalPages = 1; dom.text('project-assets-count', '0'); dom.empty('project-assets-tbody', 7, 'common.loadFailed'); renderProjectAssetsPagination(); throw error; }
  }
  async function unbindAssetFromProject(index: number) {
    const asset = service.state.assets[index]; if (!asset?.id || !service.state.selectedId || !deps.requirePermission('asset:write')) return;
    const target = asset.host || asset.domain || asset.ip || asset.id;
    if (!browser.confirm(fmt('projects.unbindAssetConfirm', `Unbind "${target}" from this project? The asset will not be deleted.`, { target }))) return;
    await service.api.unbindAsset(asset.id); deps.notify(fmt('projects.unbindAssetDone', 'Asset unbound from project', { target })); await loadProjectAssets(); await ctx.refreshStats();
  }
  return { confidenceBadge, refreshProjectHeaderStats, loadProjectFacts, deleteProjectFact, deprecateProjectFactByKey: (key: string) => confidence(key, false), restoreProjectFactByKey: (key: string) => confidence(key, true), loadProjectVulnerabilities, openVulnerabilitiesForProject, openVulnerabilityDetail, viewFactsForVulnerability,
    loadProjectConversations, openProjectConversation, promoteConversationAttackChain, unbindConversationFromProject, loadProjectAssets, renderProjectAssetsPagination, unbindAssetFromProject,
    openProjectAssetDetail(index: number) { const asset = service.state.assets[index]; if (asset) deps.openAssetDetail(asset); },
    async changeProjectAssetsPageSize(value: string) { if (service.setAssetsSize(Number(value))) await loadProjectAssets(1); },
  };
}
