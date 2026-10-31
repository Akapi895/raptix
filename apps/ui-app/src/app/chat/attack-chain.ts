import cytoscape from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createChainFlow } from '@/features/chat/attack-chain/flow';
import { drawAttackChain, type CyGraph, type GraphViewDependencies } from '@/features/chat/attack-chain/view';
import { isComplexGraph, shortenNodeLabels, type ChainNode, type ChainEdge } from '@/features/chat/attack-chain/graph-model';
import { nodeDetailHtml, statsText, type NodeData } from '@/features/chat/attack-chain/panel';
import { applyRiskFilter, applySearch, applyTypeFilter, resetFilters } from '@/features/chat/attack-chain/filters';
import { exportChain, type ExportGraph } from '@/features/chat/attack-chain/export-io';
import { openAppModal, closeAppModal, isAppModalOpen } from '@/ui/modal';
import { browser } from '@/platform/browser';
import { t, type ChatResources } from './runtime';

export function createChatAttackChain(doc: Document, resources: ChatResources, deps: {
  request(path: string, init?: RequestInit): Promise<Response>;
  context: { render(data: unknown): void; clear(): void };
}) {
  let graph: CyGraph | null = null;
  let original: { nodes?: ChainNode[]; edges?: ChainEdge[] } | null = null;
  const container = () => doc.getElementById('attack-chain-container');
  const setContent = (text: string, className: string) => {
    const el = container(); if (!el) return;
    const message = doc.createElement('div'); message.className = className; message.textContent = text; el.replaceChildren(message);
  };
  function resetContext() { graph?.destroy(); graph = null; original = null; deps.context.clear(); }
  function showDetails(data: NodeData) {
    const panel = doc.getElementById('attack-chain-details'); const content = doc.getElementById('attack-chain-details-content');
    if (!panel || !content) return;
    doc.querySelector('.attack-chain-sidebar')?.classList.add('details-active');
    browser.requestAnimationFrame(() => { if (resources.disposed) return; panel.style.display = 'flex'; browser.requestAnimationFrame(() => { panel.style.opacity = '1'; }); });
    content.scrollTop = 0;
    browser.requestAnimationFrame(() => { if (resources.disposed) return; content.innerHTML = nodeDetailHtml(data); browser.requestAnimationFrame(() => { content.scrollTop = 0; }); });
  }
  function closeDetails() {
    const panel = doc.getElementById('attack-chain-details');
    if (panel) { panel.style.opacity = '0'; resources.later(() => { panel.style.display = 'none'; panel.style.opacity = ''; doc.querySelector('.attack-chain-sidebar')?.classList.remove('details-active'); }, 220); }
    else doc.querySelector('.attack-chain-sidebar')?.classList.remove('details-active');
    graph?.elements().unselect();
  }
  function render(data: { nodes?: ChainNode[]; edges?: ChainEdge[] }) {
    if (resources.disposed) return;
    graph?.destroy(); graph = null; original = data; deps.context.render(data);
    const el = container(); if (!el) return; el.innerHTML = '';
    const nodes = data.nodes || []; const edges = data.edges || [];
    if (!nodes.length) { setContent(t('chat.noAttackChainData', 'No attack chain data'), 'empty-message'); return; }
    shortenNodeLabels(nodes, isComplexGraph(nodes.length, edges.length));
    graph = drawAttackChain({
      libs: () => ({ cytoscape, ELK }) as unknown as ReturnType<GraphViewDependencies['libs']>, container: el,
      isDark: doc.documentElement.getAttribute('data-theme') === 'dark', nodes, edges,
      onTap: data => showDetails(data as NodeData), setTimer: resources.later, warn: console.warn,
    });
  }
  const updateStats = (data: { nodes?: unknown[]; edges?: unknown[] }) => {
    const el = doc.getElementById('attack-chain-stats');
    if (el) el.textContent = statsText(data, (key, values) => { const value = t(key, '', values); return value || undefined; });
  };
  const generating = (conflict: boolean) => {
    setContent(conflict ? '⏳ Attack chain is being generated... It will appear automatically when ready' : '⏳ Generating attack chain, please wait', 'loading-spinner');
    const button = doc.createElement('button'); button.className = 'btn-secondary'; button.textContent = conflict ? 'Refresh to check progress' : 'Refresh';
    button.addEventListener('click', refresh); container()?.appendChild(button);
  };
  const setRegenerateEnabled = (enabled: boolean) => {
    const button = doc.querySelector<HTMLButtonElement>('[data-chat-attack-regenerate], [data-act-click*=regenerateAttackChain]');
    if (button) { button.disabled = !enabled; button.style.opacity = enabled ? '1' : '0.5'; button.style.cursor = enabled ? 'pointer' : 'not-allowed'; }
  };
  const flow = createChainFlow({
    t, request: deps.request, resetContext, showLoading: () => setContent(t('chat.loading', 'Loading...'), 'loading-spinner'),
    showError: message => setContent(message, 'error-message'), renderChain: data => render(data as { nodes?: ChainNode[]; edges?: ChainEdge[] }),
    updateStats: data => updateStats(data as { nodes?: unknown[]; edges?: unknown[] }), setRegenerateEnabled,
    showGenerating: () => generating(false), showRegenerating: () => setContent(t('chat.regenerating', 'Regenerating...'), 'loading-spinner'),
    showConflict: () => generating(true), refresh: () => refresh(), setTimer: resources.later, logInfo: console.log, logError: console.error,
  });
  function refresh() { const id = flow.current(); if (id) { flow.setLoading(id, false); void flow.load(id); } }
  function close() { closeAppModal('attack-chain-modal'); const id = flow.current(); if (id) flow.invalidate(id); resetContext(); closeDetails(); flow.setCurrent(null); }
  return {
    flow, render, refresh, close, closeDetails, resetContext, graph: () => graph, original: () => original,
    async show(id: string) {
      if (flow.isLoading(id) && flow.current() === id && isAppModalOpen('attack-chain-modal')) return;
      flow.begin(id); if (!doc.getElementById('attack-chain-modal')) return;
      openAppModal('attack-chain-modal', { focus: false }); updateStats({ nodes: [], edges: [] });
      setContent(t('chat.loading', 'Loading...'), 'loading-spinner');
      const details = doc.getElementById('attack-chain-details'); if (details) details.style.display = 'none';
      doc.querySelector('.attack-chain-sidebar')?.classList.remove('details-active'); setRegenerateEnabled(false); await flow.load(id);
    },
    regenerate() { const id = flow.current(); if (id) void flow.regenerate(id); },
    search: (text: string) => { if (graph && original) applySearch(graph, text); },
    filterType: (type: string) => { if (graph && original) applyTypeFilter(graph, type); },
    filterRisk: (risk: string) => { if (graph && original) applyRiskFilter(graph, risk); },
    resetFilters() {
      for (const [id, value] of [['attack-chain-search', ''], ['attack-chain-type-filter', 'all'], ['attack-chain-risk-filter', 'all']]) {
        const el = doc.getElementById(id!) as HTMLInputElement | null; if (el) el.value = value!;
      }
      if (graph) resetFilters(graph);
    },
    export: (format: string) => exportChain(format, { graph: () => graph as unknown as ExportGraph | null, conversationId: flow.current, t, alert: browser.alert, setTimer: resources.later, logError: console.error }),
    dispose() { const id = flow.current(); if (id) flow.invalidate(id); resetContext(); },
  };
}
export type ChatAttackChain = ReturnType<typeof createChatAttackChain>;
