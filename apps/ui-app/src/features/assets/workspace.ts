import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
import type { Vulnerability } from '../../api/types/vulnerability';
import { action, createDOM, icon, type ActionHandler } from './dom';
import { escapeHtml as e, errorMessage, type AssetsDependencies } from './contracts';
import { buildAssetGraph, summarizeAssets, type AssetGraph, type NodeKind } from './intelligence';
import { targetLabel, type Asset } from './model';
import type { AssetsService } from './service';
import { assetGraphLayout, compactGraphLayers } from './graph-layout';

// A sandbox/pentest project can realistically carry hundreds of hosts/services; 250 was a
// demo-sized ceiling. This bounds worst case without hiding most real topologies.
const GRAPH_NODE_LIMIT = 1500;

export function createAssetWorkspace(doc: Document, service: AssetsService, deps: AssetsDependencies, signal: AbortSignal,
  openDetail: (asset: Asset) => void, filter: (id: string, value: string) => Promise<void>) {
  const dom = createDOM(doc, signal);
  let assets: Asset[] = [], findings: Vulnerability[] = [], graph: AssetGraph = { nodes: [], edges: [] }, cy: Core | undefined;
  let view = 'inventory', request: AbortController | undefined, graphRequest: AbortController | undefined;
  let findingsStatus = '', selectedNode = '', mounted = false;
  let snapshotKey = '', builtSignature = '', fittedOnce = false;
  const kinds: NodeKind[] = ['domain', 'ip', 'port', 'service', 'vulnerability', 'asset'];
  const labels: Record<NodeKind, string> = { domain: 'Domains', ip: 'IP addresses', port: 'Ports', service: 'Services', vulnerability: 'Vulnerabilities', asset: 'Other targets' };
  const format = (value: number) => value.toLocaleString(deps.locale());
  function mount() {
    if (mounted) return; mounted = true;
    const toolbar = doc.querySelector('#page-asset-management .asset-toolbar');
    toolbar?.insertAdjacentHTML('beforeend', '<div id="asset-active-filters" class="asm-active-filters" aria-label="Active filters" hidden></div>');
    toolbar?.insertAdjacentHTML('beforebegin', `
      <section id="asset-workspace-summary" class="asm-summary" aria-label="Asset summary" aria-live="polite"><p class="muted">Loading asset summary…</p></section>
      <button id="asset-insights-toggle" class="asm-insights-toggle" type="button" aria-expanded="false" aria-controls="asset-workspace-insights" ${action('workspace.insights')}>Exposure &amp; recent discoveries</button>
      <section id="asset-workspace-insights" class="asm-insights" aria-label="Exposure and scan priorities"></section>
      <div class="asm-view-heading"><div class="asm-view-tabs" role="tablist" aria-label="Asset views">
        <button id="asset-inventory-tab" type="button" role="tab" aria-selected="true" aria-controls="asset-inventory-panel" ${action('workspace.view', { view: 'inventory' })}>Inventory</button>
        <button id="asset-graph-tab" type="button" role="tab" aria-selected="false" aria-controls="asset-graph-panel" tabindex="-1" ${action('workspace.view', { view: 'graph' })}>Asset Graph</button>
      </div><span id="asset-scope-caption" class="muted"></span></div>`);
    const card = doc.querySelector<HTMLElement>('#page-asset-management .asset-list-card');
    if (card) { card.id = 'asset-inventory-panel'; card.setAttribute('role', 'tabpanel'); card.setAttribute('aria-labelledby', 'asset-inventory-tab'); }
    card?.insertAdjacentHTML('afterend', `
      <section id="asset-graph-panel" class="asm-graph-panel" role="tabpanel" aria-labelledby="asset-graph-tab" hidden>
        <div class="asm-graph-toolbar"><label>Find a node<input id="asset-graph-search" type="search" placeholder="Domain, IP, service or finding" ${action('workspace.graph-filter', {}, 'input')}></label>
        <label>Node type<select id="asset-graph-kind" ${action('workspace.graph-filter', {}, 'change')}><option value="">All types</option>${kinds.map(kind => `<option value="${kind}">${labels[kind]}</option>`).join('')}</select></label>
        <div class="asm-graph-toolbar-actions">
          <button class="btn-icon" type="button" aria-label="Zoom in" title="Zoom in" ${action('workspace.zoom-in')}>${icon('zoom-in')}</button>
          <button class="btn-icon" type="button" aria-label="Zoom out" title="Zoom out" ${action('workspace.zoom-out')}>${icon('zoom-out')}</button>
          <button class="btn-secondary" type="button" title="Fit all visible nodes in the view" ${action('workspace.fit')}>Fit to view</button>
          <button class="btn-secondary" type="button" title="Clear node filters and reset the view" ${action('workspace.reset-view')}>Reset view</button>
          <button id="asset-graph-fullscreen-btn" class="btn-icon" type="button" aria-label="Fullscreen" title="Fullscreen" ${action('workspace.fullscreen')}>${icon('fullscreen')}</button>
        </div></div>
        <div id="asset-graph-status" class="asm-graph-status" role="status"></div>
        <div class="asm-graph-layout"><div id="asset-graph-canvas" class="asm-graph-canvas" role="img" tabindex="0" aria-label="Recorded asset relationships. Drag to pan, Ctrl+scroll or the zoom buttons to zoom, arrow keys to pan when focused."></div>
        <aside id="asset-graph-explorer" class="asm-graph-explorer" aria-label="Node details" hidden><div class="asm-graph-explorer-heading"><h3>Node details</h3><div><button type="button" class="asm-inspector-control" ${action('workspace.toggle-inspector')} aria-expanded="true" aria-controls="asset-graph-inspector">Collapse</button><button type="button" class="asm-inspector-control" ${action('workspace.clear-node')} aria-label="Close node details">Close</button></div></div><div id="asset-graph-inspector" aria-live="polite"></div>
        </aside></div>
        <div class="asm-graph-legend">${kinds.map(kind => `<span><i class="asm-node-dot asm-node-dot--${kind}"></i>${labels[kind]}</span>`).join('')}<span>Edges represent saved records, not live connectivity.</span></div>
      </section>`);
    const tabs = doc.querySelector('.asm-view-tabs');
    tabs?.addEventListener('keydown', event => {
      if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'inventory' : event.key === 'End' ? 'graph' : view === 'graph' ? 'inventory' : 'graph';
      void setView(next); dom.get(next === 'graph' ? 'asset-graph-tab' : 'asset-inventory-tab')?.focus();
    }, { signal });
    const resize = new ResizeObserver(() => { if (view === 'graph' && cy) { cy.resize(); keepSelectionVisible(); } });
    const canvas = dom.get('asset-graph-canvas');
    if (canvas) {
      resize.observe(canvas);
      canvas.addEventListener('wheel', event => {
        // Normal scroll must never be trapped by the graph; only Ctrl/Cmd+wheel zooms.
        if (!cy || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const rect = canvas.getBoundingClientRect(), factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
      }, { signal, passive: false });
      canvas.addEventListener('keydown', event => {
        if (!cy) return;
        const step = 60, zoomStep = 1.1, mid = { x: cy.width() / 2, y: cy.height() / 2 };
        const panBy: Record<string, { x: number; y: number }> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
        if (panBy[event.key]) { event.preventDefault(); cy.panBy(panBy[event.key]!); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); cy.zoom({ level: cy.zoom() * zoomStep, renderedPosition: mid }); }
        else if (event.key === '-' || event.key === '_') { event.preventDefault(); cy.zoom({ level: cy.zoom() / zoomStep, renderedPosition: mid }); }
      }, { signal });
    }
    doc.addEventListener('keydown', event => { if (event.key === 'Escape' && view === 'graph' && selectedNode) clearFocus(); }, { signal });
    doc.addEventListener('fullscreenchange', () => {
      const panel = dom.get('asset-graph-panel'), isFull = doc.fullscreenElement === panel;
      const btn = dom.get('asset-graph-fullscreen-btn');
      if (btn) { btn.innerHTML = icon(isFull ? 'fullscreen-exit' : 'fullscreen'); btn.setAttribute('aria-label', isFull ? 'Exit fullscreen' : 'Fullscreen'); btn.setAttribute('title', isFull ? 'Exit fullscreen' : 'Fullscreen'); }
      requestAnimationFrame(() => { cy?.resize(); fitGraph(); });
    }, { signal });
    signal.addEventListener('abort', () => { request?.abort(); graphRequest?.abort(); resize.disconnect(); cy?.destroy(); }, { once: true });
  }
  function summary() {
    const data = summarizeAssets(assets);
    const metric = (label: string, value: string, hint: string, name = '', valueFilter = '') => `<${name ? 'button type="button"' : 'div'} class="asm-kpi" ${name ? action('workspace.filter', { field: name, value: valueFilter }) : ''}><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(hint)}</small></${name ? 'button' : 'div'}>`;
    dom.html('asset-workspace-summary',
      metric('Total assets', format(data.total), `${format(data.domains)} domains · ${format(data.ips)} IPs`) +
      metric('Exposed services', format(data.services), 'Distinct recorded endpoints') +
      metric('High-risk assets', format(data.highRisk), 'Critical & high risk · sort inventory', 'asset-sort-filter', 'risk_level:desc') +
      metric('Scan coverage', `${data.coverage}%`, `${format(data.scanned)} of ${format(data.total)} have a scan record`, 'asset-scan-filter', 'never'));
    dom.html('asset-workspace-insights', `
      <div class="asm-insight"><h3>Exposed services</h3><div class="asm-service-list">${data.protocols.length ? data.protocols.slice(0, 5).map(([name, count]) => `<button type="button" ${action('workspace.filter', { field: 'asset-protocol-filter', value: name })}><span>${e(name.toUpperCase())}</span><strong>${format(count)}</strong></button>`).join('') : '<span class="muted">No service data recorded</span>'}</div><small>Counts are asset records per protocol.</small></div>
      <div class="asm-insight"><h3>Scan priorities</h3><div class="asm-priorities"><button type="button" ${action('workspace.filter', { field: 'asset-scan-filter', value: 'never' })}><strong>${format(data.never)}</strong> never scanned</button><button type="button" ${action('workspace.filter', { field: 'asset-scan-filter', value: '30' })}><strong>${format(data.stale)}</strong> older than 30 days</button></div><small>Scan records may include linked executions.</small></div>
      <div class="asm-insight"><h3>Recent discoveries</h3><div class="asm-discoveries">${data.discoveries.length ? data.discoveries.map(a => `<button type="button" ${action('workspace.detail', { id: a.id })} title="${e(targetLabel(a))}">${e(targetLabel(a))}<span>${e(new Date(a.first_seen_at).toLocaleDateString(deps.locale(), { month: 'short', day: 'numeric' }))}</span></button>`).join('') : '<span class="muted">No new assets in the last 7 days</span>'}</div></div>
      ${data.duplicates.groups ? `<div class="asm-insight asm-insight--warn"><h3>Possible duplicates</h3><p>${format(data.duplicates.groups)} group${data.duplicates.groups === 1 ? '' : 's'} (${format(data.duplicates.assets)} records) share the same host, port and protocol within a project but have separate record IDs. Review and use <strong>Merge duplicates</strong> from the selection menu if they're the same real target.</p></div>` : ''}`);
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
    assets = []; findings = []; graph = { nodes: [], edges: [] }; builtSignature = ''; cy?.destroy(); cy = undefined;
    dom.html('asset-workspace-summary', '<p class="muted">Loading asset summary…</p>'); dom.html('asset-workspace-insights', ''); dom.text('asset-scope-caption', '');
    dom.text('asset-graph-status', 'Loading matching assets…'); dom.html('asset-graph-inspector', '');
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
    graph = buildAssetGraph(assets.slice(0, GRAPH_NODE_LIMIT)); renderGraph();
    if (!deps.can('vulnerability:read')) return;
    dom.text('asset-graph-status', 'Loading recorded findings…');
    try {
      const params = new URLSearchParams(); const project = service.params().get('project_id'); if (project) params.set('project_id', project);
      const result = await service.findings(params, controller.signal);
      if (controller.signal.aborted || signal.aborted) return;
      findings = result; graph = buildAssetGraph(assets.slice(0, GRAPH_NODE_LIMIT), findings);
    } catch (error) { if (controller.signal.aborted || signal.aborted) return; findingsStatus = `Findings could not be loaded: ${errorMessage(error)}. Refresh to retry.`; }
    renderGraph();
  }
  /** Matching nodes plus one-hop context, so a type/search filter still explains relationships. */
  function matchingVisible() {
    const query = dom.value('asset-graph-search').trim().toLowerCase(), kind = dom.value('asset-graph-kind');
    if (!query && !kind) return { nodes: graph.nodes, edges: graph.edges };
    const matching = new Set(graph.nodes.filter(n => (!kind || n.kind === kind) && (!query || n.label.toLowerCase().includes(query))).map(n => n.id));
    const visible = new Set(matching);
    graph.edges.forEach(edge => { if (matching.has(edge.source) || matching.has(edge.target)) { visible.add(edge.source); visible.add(edge.target); } });
    return { nodes: graph.nodes.filter(n => visible.has(n.id)), edges: graph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
  }
  function buildSignature(): string { return graph.nodes.map(n => n.id).sort().join(',') + '|' + graph.edges.map(edge => edge.id).sort().join(','); }
  /** Toggles visibility on the existing cytoscape instance instead of rebuilding it, so typing in
   *  the node search or switching the type filter never discards the user's pan, zoom or layout. */
  function applyVisibility() {
    if (!cy) return;
    const visible = matchingVisible(), visibleIds = new Set(visible.nodes.map(n => n.id));
    cy.nodes().forEach(node => { node.toggleClass('asm-hidden', !visibleIds.has(node.id())); });
    cy.edges().forEach(edge => { edge.toggleClass('asm-hidden', !(visibleIds.has(String(edge.data('source'))) && visibleIds.has(String(edge.data('target'))))); });
    return visible;
  }
  function statusText(visible: { nodes: unknown[]; edges: unknown[] }) {
    dom.text('asset-graph-status', `${visible.nodes.length} nodes · ${visible.edges.length} relationships${assets.length > GRAPH_NODE_LIMIT ? ` · Showing the first ${format(GRAPH_NODE_LIMIT)} of ${format(assets.length)} matching assets; narrow inventory filters to explore more.` : ''}${findingsStatus ? ' · ' + findingsStatus : ''}${!visible.nodes.length ? ' · No recorded relationships match these filters.' : ''}`);
  }
  function fitGraph() {
    const shown = cy?.elements().not('.asm-hidden');
    if (!cy || !shown?.length) return;
    cy.resize(); cy.fit(shown, 36);
    if (cy.zoom() > 1.2) { cy.zoom(1.2); cy.center(shown); }
  }
  function renderGraph() {
    if (view !== 'graph' || signal.aborted) return;
    const canvas = dom.get('asset-graph-canvas'); if (!canvas) return;
    const signature = buildSignature(), rebuild = signature !== builtSignature;
    if (rebuild) {
      builtSignature = signature; fittedOnce = false; clearFocus();
      cy?.destroy(); cy = undefined; dom.html('asset-graph-canvas', '');
      if (!graph.nodes.length) { statusText({ nodes: [], edges: [] }); dom.html('asset-graph-canvas', '<div class="asm-graph-empty"><h3>No recorded relationships</h3><p>Clear node filters or broaden the inventory search to explore saved asset data.</p></div>'); return; }
      const colors = getComputedStyle(canvas), color = (key: string, fallback: string) => colors.getPropertyValue(key).trim() || fallback;
      cy = cytoscape({ container: canvas, elements: [...graph.nodes.map(n => ({ data: { ...n } })), ...graph.edges.map(edge => ({ data: { ...edge } }))],
        minZoom: .05, maxZoom: 4, wheelSensitivity: 0, userZoomingEnabled: false,
        layout: assetGraphLayout,
        style: [
          { selector: 'node', style: { label: (node: NodeSingular) => String(node.data('label')), 'font-size': 12, 'min-zoomed-font-size': 5, 'font-weight': 500, color: '#ffffff', 'text-wrap': 'ellipsis', 'text-max-width': '132px', 'text-valign': 'center', 'text-halign': 'center', width: 156, height: 36, shape: 'round-rectangle', 'background-color': '#526174', 'border-width': 2, 'border-color': color('--card-bg', '#ffffff') } },
          { selector: 'node[kind="domain"]', style: { 'background-color': '#4f46a5', shape: 'round-rectangle' } },
          { selector: 'node[kind="ip"]', style: { 'background-color': '#21776e' } },
          { selector: 'node[kind="port"]', style: { 'background-color': '#805916' } },
          { selector: 'node[kind="service"]', style: { 'background-color': '#3569a5', shape: 'round-rectangle' } },
          { selector: 'node[kind="vulnerability"]', style: { 'background-color': '#b42323' } },
          { selector: 'edge', style: { width: 1.5, 'line-color': color('--text-secondary', '#64748b'), 'target-arrow-color': color('--text-secondary', '#64748b'), 'target-arrow-shape': 'triangle', 'arrow-scale': .8, 'curve-style': 'bezier' } },
          { selector: 'edge.asm-connected', style: { width: 2.5, 'line-color': '#526b85', 'target-arrow-color': '#526b85' } },
          { selector: 'edge.asm-edge-hover', style: { label: 'data(label)', 'font-size': 11, 'min-zoomed-font-size': 7, color: color('--text-primary', '#18212f'), 'text-rotation': 'none', 'text-background-color': color('--card-bg', '#ffffff'), 'text-background-opacity': 1, 'text-background-padding': '3px' } },
          { selector: '.asm-faded', style: { opacity: .65 } },
          { selector: '.asm-hidden', style: { display: 'none' } },
          { selector: 'node:selected', style: { 'border-color': '#203e59', 'border-width': 4, 'overlay-color': '#527796', 'overlay-opacity': .12, 'overlay-padding': '6px' } },
        ],
      });
      compactGraphLayers(cy);
      cy.on('tap', 'node', event => inspect(String(event.target.id())));
      cy.on('tap', event => { if (event.target === cy) clearFocus(); });
      cy.on('mouseover', 'node', event => { canvas.title = String(event.target.data('label')); });
      cy.on('mouseout', 'node', () => { canvas.title = ''; });
      cy.on('mouseover', 'edge', event => event.target.addClass('asm-edge-hover'));
      cy.on('mouseout', 'edge', event => event.target.removeClass('asm-edge-hover'));
    }
    if (!graph.nodes.length) return;
    const visible = applyVisibility(); if (!visible) return;
    statusText(visible);
    if (!fittedOnce) { fitGraph(); fittedOnce = true; }
  }
  function keepSelectionVisible() {
    if (!cy || !selectedNode) return;
    const node = cy.getElementById(selectedNode); if (!node.length || node.hasClass('asm-hidden')) return;
    const box = node.renderedBoundingBox(), pad = 16, width = cy.width(), height = cy.height();
    const shift = (start: number, end: number, limit: number) => end - start > limit - 2 * pad ? limit / 2 - (start + end) / 2 : start < pad ? pad - start : end > limit - pad ? limit - pad - end : 0;
    const x = shift(box.x1, box.x2, width), y = shift(box.y1, box.y2, height);
    if (x || y) cy.panBy({ x, y });
  }
  function inspect(id: string) {
    const node = graph.nodes.find(n => n.id === id); if (!node || !cy) return; selectedNode = id;
    dom.hidden('asset-graph-explorer', false);
    dom.hidden('asset-graph-inspector', false);
    dom.get('asset-graph-explorer')?.classList.remove('is-collapsed');
    const toggle = doc.querySelector<HTMLButtonElement>('[data-assets-click="workspace.toggle-inspector"]');
    if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Collapse'; }
    cy.elements().removeClass('asm-faded asm-connected').unselect();
    const element = cy.getElementById(id); element.removeClass('asm-hidden'); element.connectedEdges().filter(edge => !edge.source().hasClass('asm-hidden') && !edge.target().hasClass('asm-hidden')).removeClass('asm-hidden');
    cy.elements().difference(element.closedNeighborhood()).addClass('asm-faded'); element.select();
    element.connectedEdges().addClass('asm-connected');
    const connections = graph.edges.filter(edge => edge.source === id || edge.target === id);
    const nodesById = new Map(graph.nodes.map(item => [item.id, item]));
    const assetsById = new Map(assets.map(asset => [asset.id, asset]));
    const records = new Map<string, string[]>();
    for (const recordId of node.assetIds) { const asset = assetsById.get(recordId), label = asset ? targetLabel(asset) : recordId; records.set(label, [...(records.get(label) || []), recordId]); }
    dom.html('asset-graph-inspector', `<section class="asm-inspector-section"><h4>Node identity</h4><div class="asm-node-name" title="${e(node.label)}">${e(node.label)}</div><p class="asm-node-meta">${e(labels[node.kind])}${node.severity ? ` · ${e(node.severity)}` : ''}</p><details class="asm-node-id"><summary>Node ID</summary><span>${e(node.id)}</span></details>${node.findingId ? `<button class="asm-inspector-link" type="button" ${action('workspace.finding', { id: node.findingId })}>Open finding</button>` : ''}</section>
      <section class="asm-inspector-section"><h4>Relationships <span>${connections.length}</span></h4><p class="asm-inspector-caption">${connections.length} recorded connections</p>${connections.length ? `<ul class="asm-connections">${connections.map(edge => { const outgoing = edge.source === id, other = nodesById.get(outgoing ? edge.target : edge.source); return `<li><button type="button" ${action('workspace.node-link', { id: other?.id || '' })} title="${e(other?.label || '')}"><span class="asm-connection-meta">${outgoing ? 'Outgoing →' : 'Incoming ←'} · ${e(edge.label)}</span><span class="asm-connection-target">${e(other?.label || '')}</span><span class="asm-connection-kind">${e(other ? labels[other.kind] : '')}</span></button></li>`; }).join('')}</ul>` : '<p class="asm-inspector-empty">No recorded relationships.</p>'}</section>
      <section class="asm-inspector-section"><h4>Linked asset records <span>${node.assetIds.length}</span></h4>${records.size ? [...records].map(([label, ids]) => `<div class="asm-record-group"><div class="asm-record-label" title="${e(label)}">${e(label)}</div>${ids.map(recordId => `<button class="asm-record-link" type="button" ${action('workspace.detail', { id: recordId })} title="${e(recordId)}">${e(recordId)}</button>`).join('')}</div>`).join('') : '<p class="asm-inspector-empty">No linked asset records.</p>'}</section>`);
    requestAnimationFrame(() => { cy?.resize(); keepSelectionVisible(); });
  }
  function clearFocus() { selectedNode = ''; cy?.elements().removeClass('asm-faded asm-connected').unselect(); dom.hidden('asset-graph-explorer', true); dom.html('asset-graph-inspector', ''); }
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
      'workspace.graph-filter': () => renderGraph(),
      'workspace.fit': fitGraph,
      'workspace.reset-view': () => { dom.set('asset-graph-search', ''); dom.set('asset-graph-kind', ''); clearFocus(); renderGraph(); fitGraph(); },
      'workspace.zoom-in': () => { if (!cy) return; cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); },
      'workspace.zoom-out': () => { if (!cy) return; cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); },
      'workspace.fullscreen': () => { const panel = dom.get('asset-graph-panel'); if (!panel) return; if (doc.fullscreenElement === panel) void doc.exitFullscreen(); else void panel.requestFullscreen?.().catch(() => {}); },
      'workspace.clear-node': clearFocus, 'workspace.node-link': el => inspect(el.dataset.id || ''),
      'workspace.toggle-inspector': el => { const expanded = el.getAttribute('aria-expanded') === 'true'; el.setAttribute('aria-expanded', String(!expanded)); el.textContent = expanded ? 'Expand' : 'Collapse'; dom.hidden('asset-graph-inspector', expanded); dom.get('asset-graph-explorer')?.classList.toggle('is-collapsed', expanded); requestAnimationFrame(() => { cy?.resize(); keepSelectionVisible(); }); },
      'workspace.finding': el => deps.setHash('vulnerabilities?id=' + encodeURIComponent(el.dataset.id || '')),
    } satisfies Record<string, ActionHandler>,
    dispose() { request?.abort(); graphRequest?.abort(); cy?.destroy(); selectedNode = ''; },
    get selectedNode() { return selectedNode; },
  };
}
