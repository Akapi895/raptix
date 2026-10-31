import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import type { Vulnerability } from '../../api/types/vulnerability';
import { action, createDOM, type ActionHandler } from './dom';
import { escapeHtml as e, errorMessage, type AssetsDependencies } from './contracts';
import { buildAssetGraph, summarizeAssets, type AssetGraph, type NodeKind } from './intelligence';
import { targetLabel, type Asset } from './model';
import type { AssetsService } from './service';

export function createAssetWorkspace(doc: Document, service: AssetsService, deps: AssetsDependencies, signal: AbortSignal,
  openDetail: (asset: Asset) => void, filter: (id: string, value: string) => Promise<void>) {
  const dom = createDOM(doc, signal);
  let assets: Asset[] = [], findings: Vulnerability[] = [], graph: AssetGraph = { nodes: [], edges: [] }, cy: Core | undefined;
  let view = 'inventory', request: AbortController | undefined, graphRequest: AbortController | undefined;
  let findingsStatus = '', selectedNode = '', mounted = false;
  let snapshotKey = '';
  const kinds: NodeKind[] = ['domain', 'ip', 'port', 'service', 'vulnerability', 'asset'];
  const labels: Record<NodeKind, string> = { domain: 'Domains', ip: 'IP addresses', port: 'Ports', service: 'Services', vulnerability: 'Vulnerabilities', asset: 'Other targets' };
  const format = (value: number) => value.toLocaleString(deps.locale());
  function mount() {
    if (mounted) return; mounted = true;
    const toolbar = doc.querySelector('#page-asset-library .asset-toolbar');
    toolbar?.insertAdjacentHTML('beforeend', '<div id="asset-active-filters" class="asm-active-filters" aria-label="Active filters" hidden></div>');
    toolbar?.insertAdjacentHTML('beforebegin', `
      <section id="asset-workspace-summary" class="asm-summary" aria-label="Asset summary" aria-live="polite"><p class="muted">Loading asset summary…</p></section>
      <button id="asset-insights-toggle" class="asm-insights-toggle" type="button" aria-expanded="false" aria-controls="asset-workspace-insights" ${action('workspace.insights')}>Exposure &amp; recent discoveries</button>
      <section id="asset-workspace-insights" class="asm-insights" aria-label="Exposure and scan priorities"></section>
      <div class="asm-view-heading"><div class="asm-view-tabs" role="tablist" aria-label="Asset views">
        <button id="asset-inventory-tab" type="button" role="tab" aria-selected="true" aria-controls="asset-inventory-panel" ${action('workspace.view', { view: 'inventory' })}>Inventory</button>
        <button id="asset-graph-tab" type="button" role="tab" aria-selected="false" aria-controls="asset-graph-panel" tabindex="-1" ${action('workspace.view', { view: 'graph' })}>Asset Graph</button>
      </div><span id="asset-scope-caption" class="muted"></span></div>`);
    const card = doc.querySelector<HTMLElement>('#page-asset-library .asset-list-card');
    if (card) { card.id = 'asset-inventory-panel'; card.setAttribute('role', 'tabpanel'); card.setAttribute('aria-labelledby', 'asset-inventory-tab'); }
    card?.insertAdjacentHTML('afterend', `
      <section id="asset-graph-panel" class="asm-graph-panel" role="tabpanel" aria-labelledby="asset-graph-tab" hidden>
        <div class="asm-graph-toolbar"><label>Find a node<input id="asset-graph-search" type="search" placeholder="Domain, IP, service or finding" ${action('workspace.graph-filter', {}, 'input')}></label>
        <label>Node type<select id="asset-graph-kind" ${action('workspace.graph-filter', {}, 'change')}><option value="">All types</option>${kinds.map(kind => `<option value="${kind}">${labels[kind]}</option>`).join('')}</select></label>
        <button class="btn-secondary" type="button" ${action('workspace.fit')}>Fit graph</button><button class="btn-secondary" type="button" ${action('workspace.clear-node')}>Clear focus</button></div>
        <div id="asset-graph-status" class="asm-graph-status" role="status"></div>
        <div class="asm-graph-layout"><div id="asset-graph-canvas" class="asm-graph-canvas" role="img" aria-label="Recorded asset relationships. Use the node list to explore with a keyboard."></div>
        <aside class="asm-graph-explorer" aria-label="Graph explorer"><h3>Explore relationships</h3><p class="muted">Select a node to inspect its recorded connections.</p>
          <label for="asset-graph-nodes">Nodes</label><select id="asset-graph-nodes" size="7" ${action('workspace.node', {}, 'change')}></select><div id="asset-graph-inspector" aria-live="polite"></div>
        </aside></div>
        <div class="asm-graph-legend">${kinds.map(kind => `<span><i class="asm-node-dot asm-node-dot--${kind}"></i>${labels[kind]}</span>`).join('')}<span>Edges represent saved records, not live connectivity.</span></div>
      </section>`);
    const tabs = doc.querySelector('.asm-view-tabs');
    tabs?.addEventListener('keydown', event => {
      if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'inventory' : event.key === 'End' ? 'graph' : view === 'graph' ? 'inventory' : 'graph';
      void setView(next); dom.get(next === 'graph' ? 'asset-graph-tab' : 'asset-inventory-tab')?.focus();
    }, { signal });
    const resize = new ResizeObserver(() => { if (view === 'graph' && cy) { cy.resize(); } });
    const canvas = dom.get('asset-graph-canvas'); if (canvas) resize.observe(canvas);
    signal.addEventListener('abort', () => { request?.abort(); graphRequest?.abort(); resize.disconnect(); cy?.destroy(); }, { once: true });
  }
  function summary() {
    const data = summarizeAssets(assets);
    const metric = (label: string, value: string, hint: string, name = '', valueFilter = '') => `<${name ? 'button type="button"' : 'div'} class="asm-kpi" ${name ? action('workspace.filter', { field: name, value: valueFilter }) : ''}><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(hint)}</small></${name ? 'button' : 'div'}>`;
    dom.html('asset-workspace-summary',
      metric('Assets', format(data.total), `${format(data.domains)} domains · ${format(data.ips)} IPs`) +
      metric('Exposed services', format(data.services), 'Distinct recorded endpoints') +
      metric('Critical & high risk', format(data.highRisk), 'Sort inventory by risk', 'asset-sort-filter', 'risk_level:desc') +
      metric('Scan coverage', `${data.coverage}%`, `${format(data.scanned)} of ${format(data.total)} have a scan record`, 'asset-scan-filter', 'never') +
      metric('New in 7 days', format(data.recent), 'Based on first discovery', 'asset-first-seen-after-filter', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)));
    dom.html('asset-workspace-insights', `
      <div class="asm-insight"><h3>Exposed services</h3><div class="asm-service-list">${data.protocols.length ? data.protocols.slice(0, 5).map(([name, count]) => `<button type="button" ${action('workspace.filter', { field: 'asset-protocol-filter', value: name })}><span>${e(name.toUpperCase())}</span><strong>${format(count)}</strong></button>`).join('') : '<span class="muted">No service data recorded</span>'}</div><small>Counts are asset records per protocol.</small></div>
      <div class="asm-insight"><h3>Scan priorities</h3><div class="asm-priorities"><button type="button" ${action('workspace.filter', { field: 'asset-scan-filter', value: 'never' })}><strong>${format(data.never)}</strong> never scanned</button><button type="button" ${action('workspace.filter', { field: 'asset-scan-filter', value: '30' })}><strong>${format(data.stale)}</strong> older than 30 days</button></div><small>Scan records may include linked executions.</small></div>
      <div class="asm-insight"><h3>Recent discoveries</h3><div class="asm-discoveries">${data.discoveries.length ? data.discoveries.map(a => `<button type="button" ${action('workspace.detail', { id: a.id })} title="${e(targetLabel(a))}">${e(targetLabel(a))}<span>${e(new Date(a.first_seen_at).toLocaleDateString(deps.locale(), { month: 'short', day: 'numeric' }))}</span></button>`).join('') : '<span class="muted">No new assets in the last 7 days</span>'}</div></div>`);
    dom.text('asset-scope-caption', `${format(data.total)} matching assets · summary follows filters`);
  }
  async function refresh(force = false) {
    const active = Object.entries(service.state.filters).filter(([id, value]) => value && !['asset-project-filter', 'asset-search', 'asset-status-filter'].includes(id) && !(id === 'asset-sort-filter' && value === 'last_seen_at:desc'));
    dom.hidden('asset-active-filters', !active.length);
    dom.html('asset-active-filters', active.map(([id, value]) => { const field = dom.field(id), label = field?.closest('label')?.querySelector('span')?.textContent || 'Sort'; const text = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent || value : value; return `<button type="button" ${action('workspace.filter', { field: id, value: id === 'asset-sort-filter' ? 'last_seen_at:desc' : '' })} aria-label="${e('Clear ' + label + ': ' + text)}">${e(label)}: ${e(text)} <span>Clear</span></button>`; }).join(''));
    const key = service.params().toString() + '|' + service.revision;
    if (!force && snapshotKey === key) return;
    snapshotKey = '';
    mount(); request?.abort(); graphRequest?.abort(); const controller = new AbortController(); request = controller;
    assets = []; findings = []; graph = { nodes: [], edges: [] }; cy?.destroy(); cy = undefined;
    dom.html('asset-workspace-summary', '<p class="muted">Loading asset summary…</p>'); dom.html('asset-workspace-insights', ''); dom.text('asset-scope-caption', '');
    dom.text('asset-graph-status', 'Loading matching assets…'); dom.html('asset-graph-nodes', ''); dom.html('asset-graph-inspector', '');
    try {
      const result = await service.inventory(service.params(), controller.signal);
      if (controller.signal.aborted || signal.aborted) return;
      assets = result; snapshotKey = key; summary(); if (view === 'graph') await loadGraph();
    } catch (error) {
      if (controller.signal.aborted || signal.aborted) return;
      dom.html('asset-workspace-summary', `<p class="asm-error">Could not load the asset summary. ${e(errorMessage(error))} <button class="btn-link" type="button" ${action('asset.load')}>Retry</button></p>`);
      dom.text('asset-graph-status', 'Asset data unavailable. Use Refresh to retry.');
    }
  }
  async function loadGraph() {
    graphRequest?.abort(); const controller = new AbortController(); graphRequest = controller;
    findingsStatus = deps.can('vulnerability:read') ? '' : 'Finding access is unavailable for this account.';
    graph = buildAssetGraph(assets.slice(0, 250)); await renderGraph();
    if (!deps.can('vulnerability:read')) return;
    dom.text('asset-graph-status', 'Loading recorded findings…');
    try {
      const params = new URLSearchParams(); const project = service.params().get('project_id'); if (project) params.set('project_id', project);
      const result = await service.findings(params, controller.signal);
      if (controller.signal.aborted || signal.aborted) return;
      findings = result; graph = buildAssetGraph(assets.slice(0, 250), findings);
    } catch (error) { if (controller.signal.aborted || signal.aborted) return; findingsStatus = `Findings could not be loaded: ${errorMessage(error)}. Refresh to retry.`; }
    await renderGraph();
  }
  function visibleGraph() {
    const query = dom.value('asset-graph-search').trim().toLowerCase(), kind = dom.value('asset-graph-kind');
    const matching = new Set(graph.nodes.filter(n => (!kind || n.kind === kind) && (!query || n.label.toLowerCase().includes(query))).map(n => n.id));
    const visible = new Set(matching);
    // Include one-hop context so a type/search filter still explains relationships.
    if (query || kind) graph.edges.forEach(edge => { if (matching.has(edge.source) || matching.has(edge.target)) { visible.add(edge.source); visible.add(edge.target); } });
    return { nodes: graph.nodes.filter(n => visible.has(n.id)), edges: graph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
  }
  function renderGraph() {
    if (view !== 'graph' || signal.aborted) return;
    const visible = visibleGraph();
    dom.html('asset-graph-nodes', visible.nodes.map(n => `<option value="${e(n.id)}">${e(n.kind)}: ${e(n.label)}</option>`).join(''));
    dom.text('asset-graph-status', `${visible.nodes.length} nodes · ${visible.edges.length} relationships${assets.length > 250 ? ` · Showing the first 250 of ${assets.length} matching assets; narrow inventory filters to explore more.` : ''}${findingsStatus ? ' · ' + findingsStatus : ''}${!visible.nodes.length ? ' · No recorded relationships match these filters.' : ''}`);
    const canvas = dom.get('asset-graph-canvas'); if (!canvas) return;
    cy?.destroy(); cy = undefined;
    dom.html('asset-graph-canvas', '');
    if (!visible.nodes.length) { dom.html('asset-graph-inspector', ''); dom.html('asset-graph-canvas', '<div class="asm-graph-empty"><h3>No recorded relationships</h3><p>Clear node filters or broaden the inventory search to explore saved asset data.</p></div>'); return; }
    const colors = getComputedStyle(canvas), color = (key: string, fallback: string) => colors.getPropertyValue(key).trim() || fallback;
    const narrow = canvas.clientWidth < 500;
    cy = cytoscape({ container: canvas, elements: [...visible.nodes.map(n => ({ data: { ...n } })), ...visible.edges.map(edge => ({ data: { ...edge } }))],
      minZoom: .2, maxZoom: 3, wheelSensitivity: .15,
      layout: { name: 'breadthfirst', directed: true, padding: 36, spacingFactor: 1.35, animate: false },
      style: [
        { selector: 'node', style: { label: (node: NodeSingular) => narrow && ['service', 'vulnerability'].includes(String(node.data('kind'))) ? '' : String(node.data('label')), 'font-size': narrow ? 10 : 11, 'min-zoomed-font-size': 8, color: color('--text-primary', '#18212f'), 'text-wrap': 'ellipsis', 'text-max-width': narrow ? '68px' : '140px', 'text-valign': 'bottom', 'text-margin-y': 8, width: 28, height: 28, 'background-color': '#64748b', 'border-width': 2, 'border-color': color('--card-bg', '#ffffff') } },
        { selector: 'node[kind="domain"]', style: { 'background-color': '#4f46a5', shape: 'round-rectangle' } },
        { selector: 'node[kind="ip"]', style: { 'background-color': '#21776e' } },
        { selector: 'node[kind="port"]', style: { 'background-color': '#986b20', shape: 'diamond', width: 22, height: 22 } },
        { selector: 'node[kind="service"]', style: { 'background-color': '#3569a5', shape: 'round-rectangle' } },
        { selector: 'node[kind="vulnerability"]', style: { 'background-color': '#c62828', shape: 'hexagon' } },
        { selector: 'edge', style: { width: 1, 'line-color': color('--text-secondary', '#64748b'), 'target-arrow-color': color('--text-secondary', '#64748b'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' } },
        { selector: '.asm-faded', style: { opacity: .15 } },
        { selector: ':selected', style: { 'border-color': '#c62828', 'border-width': 3 } },
        { selector: 'node:selected', style: { label: 'data(label)', 'text-max-width': '160px', 'text-background-color': color('--card-bg', '#ffffff'), 'text-background-opacity': 1, 'text-background-padding': '3px' } },
      ],
    });
    cy.on('tap', 'node', event => inspect(String(event.target.id())));
    cy.on('tap', event => { if (event.target === cy) clearFocus(); });
    selectedNode = ''; dom.html('asset-graph-inspector', '');
  }
  function inspect(id: string) {
    const node = graph.nodes.find(n => n.id === id); if (!node || !cy) return; selectedNode = id;
    cy.elements().removeClass('asm-faded').unselect();
    const element = cy.getElementById(id); cy.elements().difference(element.closedNeighborhood()).addClass('asm-faded'); element.select();
    dom.set('asset-graph-nodes', id);
    const connections = graph.edges.filter(edge => edge.source === id || edge.target === id);
    dom.html('asset-graph-inspector', `<h4>${e(node.label)}</h4><p>${e(labels[node.kind])} · ${connections.length} recorded connections</p>
      <ul class="asm-connections">${connections.slice(0, 30).map(edge => { const other = graph.nodes.find(n => n.id === (edge.source === id ? edge.target : edge.source)); return `<li><small>${e(edge.label)}</small><button type="button" ${action('workspace.node-link', { id: other?.id || '' })}>${e(other?.label)}</button></li>`; }).join('')}</ul>
      ${node.findingId ? `<button class="btn-link" type="button" ${action('workspace.finding', { id: node.findingId })}>Open finding</button>` : ''}
      <h4>Asset records</h4>${node.assetIds.slice(0, 20).map(id => { const asset = assets.find(a => a.id === id); return `<button class="asm-record-link" type="button" ${action('workspace.detail', { id })}>${e(asset ? targetLabel(asset) : id)}</button>`; }).join('')}`);
  }
  function clearFocus() { selectedNode = ''; cy?.elements().removeClass('asm-faded').unselect(); dom.html('asset-graph-inspector', ''); }
  async function setView(next: string) {
    mount(); view = next === 'graph' ? 'graph' : 'inventory';
    for (const name of ['inventory', 'graph']) { const active = view === name; const tab = dom.get(`asset-${name}-tab`); tab?.setAttribute('aria-selected', String(active)); tab?.setAttribute('tabindex', active ? '0' : '-1'); dom.hidden(`asset-${name}-panel`, !active); }
    dom.hidden('asset-batch-actions', view === 'graph' || !service.state.selected.size);
    if (view === 'graph') await loadGraph(); else graphRequest?.abort();
  }
  return { mount, refresh, setView, get assets() { return assets; },
    handlers: {
      'workspace.insights': el => { const expanded = el.getAttribute('aria-expanded') !== 'true'; el.setAttribute('aria-expanded', String(expanded)); dom.get('asset-workspace-insights')?.classList.toggle('is-expanded', expanded); },
      'workspace.view': el => setView(el.dataset.view || ''),
      'workspace.filter': el => filter(el.dataset.field || '', el.dataset.value || ''),
      'workspace.detail': el => { const asset = assets.find(a => a.id === el.dataset.id); if (asset) openDetail(asset); },
      'workspace.graph-filter': () => renderGraph(), 'workspace.fit': () => { cy?.fit(undefined, 36); },
      'workspace.clear-node': clearFocus, 'workspace.node': el => inspect((el as HTMLSelectElement).value), 'workspace.node-link': el => inspect(el.dataset.id || ''),
      'workspace.finding': el => deps.setHash('vulnerabilities?id=' + encodeURIComponent(el.dataset.id || '')),
    } satisfies Record<string, ActionHandler>,
    dispose() { request?.abort(); graphRequest?.abort(); cy?.destroy(); selectedNode = ''; },
    get selectedNode() { return selectedNode; },
  };
}
