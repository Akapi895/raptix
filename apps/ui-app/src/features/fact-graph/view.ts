import cytoscape, { type Core, type ElementDefinition, type NodeSingular, type EdgeSingular } from 'cytoscape';
import { buildNodeCard, EDGE_COLORS, escapeXml } from './cards';
import { layoutGraph } from './layout';
import { resolveGraphNodeType } from './service';
import type { FactGraph, GraphOptions, GraphNodeData, GraphEdge } from './types';

export function createFactGraphView(document: Document) {
  let cy: Core | null = null, resize: ResizeObserver | null = null;
  let connect = false, pick: ((key: string) => void) | undefined;
  const dark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  function destroy() { resize?.disconnect(); resize = null; cy?.destroy(); cy = null; }
  function center() { if (!cy || cy.destroyed()) return; cy.resize(); cy.fit(undefined, 56); if (cy.zoom() < 0.65) { cy.zoom(0.65); cy.center(); } }
  function refreshTheme() {
    if (!cy) return;
    cy.nodes().forEach(node => { const data = node.data() as GraphNodeData; node.data(buildNodeCard(data.type, data.summary, data.confidence, data.factKey, dark())); });
    cy.style().selector('node').style('background-color', dark() ? '#1e293b' : '#ffffff')
      .selector('node:selected').style('border-color', dark() ? '#60a5fa' : '#4F46E5')
      .selector('edge:selected').style({ 'line-color': dark() ? '#60a5fa' : '#4F46E5', 'target-arrow-color': dark() ? '#60a5fa' : '#4F46E5' }).update();
  }
  function render(container: HTMLElement, data: FactGraph, options: GraphOptions = {}): Core | null {
    destroy();
    if (!data.nodes.length) {
      container.innerHTML = `<div class="project-fact-graph-empty"><div class="project-fact-graph-empty-icon" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none"><circle cx="6" cy="6" r="2.5" fill="#4F46E5"/><circle cx="18" cy="6" r="2.5" fill="#E11D48"/><circle cx="12" cy="18" r="2.5" fill="#0D9488"/><path d="M8 7l4 9M16 7l-4 9M8 7h8" stroke="#CBD5E1" stroke-width="1.5"/></svg></div>${options.emptyTitle ? `<h4 class="project-fact-graph-empty-title">${escapeXml(options.emptyTitle)}</h4>` : ''}<p class="project-fact-graph-empty-hint">${escapeXml(options.emptyText || 'No fact relationships yet')}</p>${options.emptySteps?.length ? `<ol class="project-fact-graph-empty-steps">${options.emptySteps.map(step => `<li>${escapeXml(step)}</li>`).join('')}</ol>` : ''}${options.emptyActionLabel && options.onEmptyAction ? `<button type="button" class="btn-primary btn-small project-fact-graph-empty-cta">${escapeXml(options.emptyActionLabel)}</button>` : ''}</div>`;
      if (options.onEmptyAction) container.querySelector('button')?.addEventListener('click', options.onEmptyAction);
      return null;
    }
    container.replaceChildren();
    const ids = new Set(data.nodes.map(node => node.id));
    const edges = data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map((edge, i) => ({ ...edge, id: edge.id || `e-${i}` }));
    const elements: ElementDefinition[] = data.nodes.map(node => {
      const type = resolveGraphNodeType(node), factKey = node.fact_key || node.id;
      const card = buildNodeCard(type, (node.summary || node.label || '').trim() || '—', node.confidence, factKey, dark());
      return { data: { ...node, ...card, factKey, type, typeLabel: card.theme.typeLabel, typeEn: card.theme.typeEn, accentColor: card.theme.accent } };
    });
    elements.push(...edges.map(edge => ({ data: { ...edge, type: edge.type || 'leads_to', confidence: edge.confidence || 'confirmed' } })));
    cy = cytoscape({ container, elements, minZoom: 0.35, maxZoom: 3, style: [
      { selector: 'node', style: { label: '', width: (node: NodeSingular) => Number(node.data('nodeWidth')) || 340, height: node => Number(node.data('nodeHeight')) || 88,
        shape: 'round-rectangle', 'background-color': dark() ? '#1e293b' : '#ffffff', 'background-image': (node: NodeSingular) => String(node.data('cardSvgUrl') || 'none'),
        'background-width': node => `${Number(node.data('nodeWidth')) || 340}px`, 'background-height': node => `${Number(node.data('nodeHeight')) || 88}px`,
        'background-position-x': '50%', 'background-position-y': '50%', 'background-fit': 'none', 'border-width': 0, 'background-opacity': 1 } },
      { selector: 'edge', style: { width: 2.2, 'line-color': edge => EDGE_COLORS[String(edge.data('type'))] || '#CBD5E1',
        'target-arrow-color': edge => EDGE_COLORS[String(edge.data('type'))] || '#CBD5E1', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier',
        opacity: (edge: EdgeSingular) => edge.data('confidence') === 'tentative' ? 0.55 : 0.9, 'line-style': edge => edge.data('confidence') === 'tentative' ? 'dashed' : 'solid' } },
      { selector: 'edge:selected', style: { width: 3.5, opacity: 1, 'line-color': dark() ? '#60a5fa' : '#4F46E5', 'target-arrow-color': dark() ? '#60a5fa' : '#4F46E5' } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': dark() ? '#60a5fa' : '#4F46E5', 'border-opacity': 1 } },
    ] });
    const instance = cy;
    instance.userPanningEnabled(!connect);
    instance.on('tap', 'node', event => { const node = event.target.data() as GraphNodeData; if (connect && pick) pick(node.factKey || node.id); else options.onNodeSelect?.(node.factKey || node.id, node); });
    instance.on('tap', 'edge', event => { if (!connect) { const edge = event.target.data() as GraphEdge; options.onEdgeSelect?.(edge.id, edge); } });
    instance.on('tap', event => { if (event.target === instance) instance.elements().unselect(); });
    void layoutGraph(instance, data, edges, () => { if (cy === instance) center(); });
    if (typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(() => { if (!instance.destroyed()) instance.resize(); }); resize.observe(container); }
    return instance;
  }
  document.addEventListener('raptix-themechange', refreshTheme);
  return { render, destroy, center, refreshTheme,
    filterBySearch(query: string) { const q = query.trim().toLowerCase(); cy?.nodes().forEach(node => { const data = node.data() as GraphNodeData; node.style('opacity', !q || `${data.label} ${data.factKey} ${data.typeLabel}`.toLowerCase().includes(q) ? 1 : 0.15); }); cy?.edges().style('opacity', q ? 0.12 : 0.9); },
    selectEdge(id: string) { cy?.elements().unselect(); cy?.getElementById(id).select(); },
    clearEdgeSelection() { cy?.elements().unselect(); },
    setConnectMode(enabled: boolean, onPick?: (key: string) => void) { connect = enabled; pick = onPick; cy?.userPanningEnabled(!connect); },
    dispose() { destroy(); document.removeEventListener('raptix-themechange', refreshTheme); },
  };
}
export type FactGraphView = ReturnType<typeof createFactGraphView>;
