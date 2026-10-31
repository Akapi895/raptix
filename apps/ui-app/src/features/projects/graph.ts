import { createFactGraphView, nodeTheme, resolveGraphNodeType, type GraphEdge } from '../fact-graph';
import { projectsBrowser as browser } from '../../platform/projects-browser';
import type { ProjectsContext } from './context';
import { esc } from './dom';

export function createProjectGraph(ctx: ProjectsContext) {
  const { dom, service, deps } = ctx, { t } = dom;
  const graph = createFactGraphView(dom.document);
  let selectedKey = '', selectedEdge = '', connecting = false, source = '';
  const synthetic = (edge?: GraphEdge) => !edge || edge.id.startsWith('vuln-link:') || edge.type === 'links_vuln';
  function closeProjectFactGraphSidebar() { selectedKey = ''; selectedEdge = ''; graph.clearEdgeSelection(); dom.hidden('project-fact-graph-sidebar', true); }
  function showNode(key: string, edgeId = '') {
    selectedKey = key; selectedEdge = edgeId;
    const data = service.state.graph, node = data?.nodes.find(node => node.fact_key === key || node.id === key), vulnId = key.startsWith('vuln:') ? key.slice(5) : '';
    dom.text('project-fact-graph-node-title', vulnId || key); const title = dom.el('project-fact-graph-node-title'); if (title) title.title = vulnId || key;
    const type = node ? resolveGraphNodeType(node) : 'note', theme = nodeTheme(type), category = dom.el('project-fact-graph-node-category');
    if (category) { category.textContent = theme.typeEn; category.hidden = false; category.title = theme.typeLabel; category.className = `project-fact-graph-node-category project-fact-graph-node-category--${type}`; }
    const summary = (node?.summary || node?.label || '').trim();
    dom.html('project-fact-graph-node-meta', `${summary ? `<span class="project-fact-graph-node-summary">${esc(summary)}</span>` : ''}${vulnId ? `<span class="project-fact-graph-node-vuln-hint">${esc(t('projects.graphVulnSidebarHint'))}</span>` : ''}${node?.confidence ? `<span class="projects-confidence projects-confidence--${node.confidence === 'confirmed' || node.confidence === 'deprecated' ? node.confidence : 'tentative'}">${esc(t('projects.confidence' + node.confidence.charAt(0).toUpperCase() + node.confidence.slice(1)))}</span>` : ''}`);
    dom.text('project-fact-graph-detail-btn', t(vulnId ? 'projects.viewVulnerability' : 'projects.details')); dom.hidden('project-fact-graph-edit-btn', !!vulnId);
    const edges = data?.edges.filter(edge => edge.source === key || edge.target === key) ?? [];
    dom.hidden('project-fact-graph-edges-wrap', false);
    dom.html('project-fact-graph-edges-list', edges.length ? edges.map(edge => `<div class="project-fact-graph-edge-item${edge.id === edgeId ? ' is-selected' : ''}" data-action="projects.focus-edge" data-edge-id="${esc(edge.id)}"><span class="project-fact-graph-edge-dir">${esc(t(edge.source === key ? 'projects.graphEdgeFromSelf' : 'projects.graphEdgeToSelf'))}</span><span class="project-fact-graph-edge-type">${esc(edge.type)}</span><span class="project-fact-graph-edge-peer" title="${esc(edge.source + ' → ' + edge.target)}">${esc(edge.source)} → ${esc(edge.target)}</span>${synthetic(edge) ? `<span class="project-fact-graph-edge-synthetic" title="${esc(t('projects.graphEdgeSynthetic'))}">—</span>` : `<button type="button" class="project-fact-graph-edge-delete" data-action="projects.delete-edge" data-edge-id="${esc(edge.id)}" title="${esc(t('projects.graphDeleteEdge'))}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`}</div>`).join('') : `<p class="project-fact-graph-edges-empty">${esc(t('projects.graphEdgesEmpty'))}</p>`);
    if (selectedEdge) {
      graph.selectEdge(selectedEdge);
      dom.el('project-fact-graph-edges-list')?.querySelectorAll<HTMLElement>('[data-edge-id]').forEach(element => { if (element.dataset.edgeId === selectedEdge && element.classList.contains('project-fact-graph-edge-item')) element.scrollIntoView({ block: 'nearest' }); });
    } else graph.clearEdgeSelection();
    dom.hidden('project-fact-graph-sidebar', false);
  }
  function focusProjectFactGraphEdge(id: string) { const edge = service.state.graph?.edges.find(edge => edge.id === id); if (edge) showNode(edge.source && !edge.source.startsWith('vuln:') ? edge.source : edge.target, id); }
  async function loadProjectFactGraph() {
    const container = dom.el('project-fact-graph-container'); if (!container || !service.state.selectedId) return;
    graph.destroy(); closeProjectFactGraphSidebar(); container.innerHTML = `<div class="loading-spinner">${esc(t('common.loading'))}</div>`;
    const id = service.state.selectedId;
    try {
      const data = await service.loadGraph(dom.value('project-graph-view') || 'path', dom.checked('project-facts-filter-hide-deprecated'));
      if (!data) return;
      graph.render(container, data, { emptyText: t('projects.graphEmpty'), emptyTitle: t('projects.graphEmptyTitle'), emptySteps: [1, 2, 3].map(n => t(`projects.graphEmptyStep${n}`)), emptyActionLabel: t('projects.graphEmptyCta'), onEmptyAction: ctx.showNewFact, onNodeSelect: key => showNode(key), onEdgeSelect: focusProjectFactGraphEdge });
      dom.html('project-fact-graph-stats', `<span class="projects-graph-stat-badge"><strong>${data.nodes.length}</strong> ${esc(t('projects.graphStatsNodes'))}</span><span class="projects-graph-stat-badge"><strong>${data.edges.length}</strong> ${esc(t('projects.graphStatsEdges'))}</span>`);
    } catch (error) { if (id === service.state.selectedId) { container.innerHTML = `<div class="error-message">${esc(error instanceof Error ? error.message : t('common.loadFailed'))}</div>`; dom.text('project-fact-graph-stats', ''); } }
  }
  async function handlePick(key: string) {
    if (!key || key.startsWith('vuln:') || !deps.requirePermission('project:write')) return;
    if (!source) { source = key; deps.notify(dom.fmt('projects.graphConnectPickTarget', `Source node ${key} selected; click the target node`, { source: key }), 'info'); return; }
    if (source === key) return;
    const from = source, id = service.state.selectedId, type = browser.prompt(t('projects.graphEdgeTypePrompt'), 'leads_to'); source = '';
    if (!type) return;
    await service.api.createEdge(id, from, key, type.trim()); deps.notify(t('projects.graphConnectSuccess'), 'success'); await loadProjectFactGraph(); await ctx.refreshFacts();
  }
  function toggleProjectFactGraphConnectMode() {
    connecting = !connecting; source = ''; const button = dom.el('project-graph-connect-btn');
    button?.classList.toggle('is-active', connecting); button?.classList.toggle('projects-graph-action-btn--connect-active', connecting); dom.text('project-graph-connect-btn', t(connecting ? 'projects.graphConnectActive' : 'projects.graphConnect'));
    graph.setConnectMode(connecting, key => ctx.run(() => handlePick(key)));
  }
  async function deleteProjectFactEdge(id: string) {
    const edge = service.state.graph?.edges.find(edge => edge.id === id);
    if (synthetic(edge) || !deps.requirePermission('project:write') || !browser.confirm(t('projects.confirmDeleteGraphEdge'))) return;
    await service.api.deleteEdge(service.state.selectedId, id); deps.notify(t('projects.graphEdgeDeleteSuccess'), 'success'); const key = selectedKey; await loadProjectFactGraph(); if (key) showNode(key); await ctx.refreshFacts();
  }
  return { graph, loadProjectFactGraph, closeProjectFactGraphSidebar, focusProjectFactGraphEdge, deleteProjectFactEdge, toggleProjectFactGraphConnectMode,
    filterProjectFactGraph: () => graph.filterBySearch(dom.value('project-graph-search')), centerProjectFactGraph: graph.center,
    openSelectedGraphFactDetail() { if (selectedKey.startsWith('vuln:')) ctx.openVulnerability(selectedKey.slice(5)); else if (selectedKey) ctx.run(() => ctx.showFact(selectedKey)); },
    editSelectedGraphFact() { if (selectedKey && !selectedKey.startsWith('vuln:')) ctx.run(() => ctx.showEditFact(selectedKey)); },
    reset() { source = ''; closeProjectFactGraphSidebar(); graph.destroy(); }, dispose: graph.dispose,
  };
}
