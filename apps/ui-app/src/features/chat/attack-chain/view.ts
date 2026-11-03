// The attack-chain graph on the screen: Cytoscape with the card-style nodes and the typed edges, laid out by ELK (or the
// built-in layout when ELK is not there), centred on its content, with a tap that opens a node and a hover that reads
// its connections. The graph library and the layout library are the page's own scripts.

import { buildGraphElements, isComplexGraph, type ChainEdge, type ChainNode } from './graph-model';

export interface CyElement {
  data(key?: string): unknown;
  style(name?: unknown, value?: unknown): unknown;
  connectedEdges(): CyCollection;
  position(pos: { x: number; y: number }): void;
}

export interface CyCollection {
  unselect(): void;
  not(other: CyCollection): CyCollection;
  style(name: unknown, value?: unknown): unknown;
  forEach(callback: (element: CyElement & { source?: () => CyCollection; target?: () => CyCollection; length?: number }) => void): void;
  nodes?(): CyCollection;
  length?: number;
}

export interface CyGraph {
  destroy(): void;
  container(): HTMLElement | null;
  fit(elements: unknown, padding: number): void;
  zoom(arg?: number | { level: number; position: { x: number; y: number } }): number | void;
  extent(): { x1: number; x2: number; y1: number; y2: number };
  center(): void;
  getElementById(id: string): CyElement & { data(key?: string): unknown };
  elements(): CyCollection;
  nodes(): CyCollection;
  edges(): CyCollection & { style(name: unknown, value?: unknown): unknown };
  layout(options: unknown): { one(event: string, callback: () => void): void; run(): void };
  on(event: string, selectorOrHandler: unknown, handler?: (evt: { target: CyElement & { data(key?: string): unknown; connectedEdges(): CyCollection; style(name: unknown): void }; evt?: unknown }) => void): void;
}

interface PageGraphLibs {
  cytoscape?: (options: Record<string, unknown>) => CyGraph;
  ELK?: new () => { layout(graph: unknown): Promise<{ children?: { id: string; x?: number; y?: number; width?: number; height?: number }[] }> };
}

export interface GraphViewDependencies {
  libs(): PageGraphLibs;
  container: HTMLElement;
  isDark: boolean;
  nodes: ChainNode[];
  edges: ChainEdge[];
  onTap(data: Record<string, unknown>): void;
  setTimer(callback: () => void, ms: number): unknown;
  warn(message: string, detail?: unknown): void;
}

const DEFAULT_LABEL_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif';

function nodeWidth(type: unknown, complex: boolean): number {
  if (type === 'target') return complex ? 300 : 360;
  if (type === 'vulnerability') return complex ? 280 : 340;
  return complex ? 260 : 320;
}

function edgeColor(type: unknown): string {
  if (type === 'discovers' || type === 'targets') return '#4F46E5';
  if (type === 'enables') return '#E11D48';
  if (type === 'leads_to') return '#64748B';
  return '#cbd5e1';
}

/** The graph's style sheet: card nodes with an icon, a two-line label and a soft gradient; typed edges. */
export function graphStyles(complex: boolean): unknown[] {
  return [
    {
      selector: 'node',
      style: {
        'label': (ele: CyElement) => {
          const line1 = String(ele.data('typeEn') || '') + '  ·  ' + String(ele.data('typeLabel') || '') +
            (ele.data('badgeText') ? '  [' + String(ele.data('badgeText')) + ']' : '');
          return line1 + '\n' + String(ele.data('label') || '');
        },
        'width': (ele: CyElement) => nodeWidth(ele.data('type'), complex),
        'height': () => (complex ? 84 : 100),
        'shape': 'round-rectangle',
        'background-fill': 'linear-gradient',
        'background-gradient-direction': 'to-bottom-right',
        'background-gradient-stop-colors': (ele: CyElement) => String(ele.data('bgGradientStart') || '#FFFFFF') + ' ' + String(ele.data('bgGradientEnd') || '#F8FAFC'),
        'background-gradient-stop-positions': '0 100',
        'background-opacity': 1,
        'background-image': (ele: CyElement) => String(ele.data('iconDataUrl') || 'none'),
        'background-image-containment': 'inside',
        'background-fit': 'none',
        'background-image-opacity': 1,
        'background-width': '36px',
        'background-height': '36px',
        'background-position-x': '18px',
        'background-position-y': '50%',
        'background-offset-y': '0',
        'background-clip': 'node',
        'bounds-expansion': 0,
        'border-width': 1.5,
        'border-color': (ele: CyElement) => String(ele.data('accentColor') || '#94a3b8'),
        'border-opacity': 0.5,
        'color': (ele: CyElement) => String(ele.data('labelTextColor') || '#0f172a'),
        'font-size': () => (complex ? '13px' : '14px'),
        'font-weight': 700,
        'font-family': DEFAULT_LABEL_FONT,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-justification': 'left',
        'text-wrap': 'wrap',
        'text-max-width': (ele: CyElement) => {
          const w = nodeWidth(ele.data('type'), complex);
          return (w - 80) + 'px';
        },
        'text-overflow-wrap': 'anywhere',
        'text-margin-x': 28,
        'text-margin-y': 0,
        'padding': '12px',
        'line-height': 1.4,
        'text-outline-width': 0,
        'overlay-color': '#0f172a',
        'overlay-opacity': 0,
        'overlay-padding': 0,
        'transition-property': 'overlay-opacity, border-width, border-color',
        'transition-duration': '160ms',
      },
    },
    { selector: 'node[type = "target"]', style: { 'border-width': 2 } },
    { selector: 'node[type = "vulnerability"]', style: { 'border-width': 2 } },
    {
      selector: 'edge',
      style: {
        'width': (ele: CyElement) => {
          const type = ele.data('type');
          if (type === 'discovers') return 2.6;
          if (type === 'enables') return 2.8;
          return 2;
        },
        'line-color': (ele: CyElement) => edgeColor(ele.data('type')),
        'target-arrow-color': (ele: CyElement) => edgeColor(ele.data('type')),
        'target-arrow-shape': 'triangle-backcurve',
        'arrow-scale': 1.35,
        'curve-style': 'bezier',
        'control-point-step-size': 60,
        'opacity': 0.88,
        'line-style': (ele: CyElement) => (ele.data('type') === 'targets' ? 'dashed' : 'solid'),
        'line-dash-pattern': (ele: CyElement) => (ele.data('type') === 'targets' ? [10, 5] : []),
        'transition-property': 'opacity, width, line-color',
        'transition-duration': '160ms',
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3.5,
        'border-color': '#4F46E5',
        'z-index': 999,
        'opacity': 1,
        'overlay-opacity': 0.06,
        'overlay-color': '#4F46E5',
        'overlay-padding': 8,
      },
    },
  ];
}

/** The ELK layout input: the same sizes as the nodes' styles, and a top-down layered layout with fewer crossings. */
export function elkGraphOf(nodes: ChainNode[], edges: ChainEdge[], complex: boolean): Record<string, unknown> {
  const small = nodes.length <= 8 && edges.length <= 12;
  const nodeGap = complex ? 45 : small ? 80 : 60;
  const layerGap = complex ? 70 : small ? 130 : 95;
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.padding': '[top=30,left=50,bottom=30,right=50]',
      'elk.spacing.nodeNode': String(nodeGap),
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.componentComponent': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.nodePlacement.bk.edgeStraightening': 'IMPROVE_STRAIGHTNESS',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.semiInteractive': 'false',
      'elk.layered.thoroughness': String(complex ? 10 : 15),
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.compaction.connectedComponents': 'true',
      'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.layered.mergeEdges': 'false',
    },
    children: nodes.map(node => ({ id: node.id, width: nodeWidth(node.type || '', complex), height: complex ? 84 : 100 })),
    edges: edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
}

/**
 * Draws the graph into the container. Returns the instance so the caller can destroy it, or null when the container is not
 * there or the chain has no node to show.
 */
export function drawAttackChain(deps: GraphViewDependencies): CyGraph | null {
  const libs = deps.libs();
  if (!libs.cytoscape) return null;
  const complex = isComplexGraph(deps.nodes.length, deps.edges.length);
  const built = buildGraphElements(deps.nodes, deps.edges, deps.isDark);
  if (built.skipped.length) deps.warn('Skipped invalid edges: source or target node missing', built.skipped);

  const graph = libs.cytoscape({
    container: deps.container,
    elements: built.elements,
    style: graphStyles(complex),
    userPanningEnabled: true,
    userZoomingEnabled: true,
    boxSelectionEnabled: true,
    minZoom: 0.2,
    maxZoom: 3,
  });

  const fallback = () => {
    const layout = graph.layout({ name: 'breadthfirst', directed: true, spacingFactor: complex ? 3.0 : 2.5, padding: 40 });
    layout.one('layoutstop', () => deps.setTimer(() => centerAttackChain(graph, deps), 100));
    layout.run();
  };

  if (!libs.ELK) {
    deps.warn('ELK.js is not loaded; using the default layout. Check that the elkjs library loads correctly.');
    fallback();
  } else {
    try {
      const elk = new libs.ELK();
      elk.layout(elkGraphOf(deps.nodes, built.validEdges, complex)).then(laidOut => {
        if (!laidOut?.children) throw new Error('ELK layout returned an invalid result');
        laidOut.children.forEach(item => {
          const node = graph.getElementById(item.id);
          if (node && item.x !== undefined && item.y !== undefined) {
            node.position({ x: item.x + (item.width || 0) / 2, y: item.y + (item.height || 0) / 2 });
          }
        });
        deps.setTimer(() => centerAttackChain(graph, deps), 150);
      }).catch(error => {
        deps.warn('ELK layout calculation failed; using the default layout:', error);
        fallback();
      });
    } catch (error) {
      deps.warn('ELK layout initialization failed; using the default layout:', error);
      fallback();
    }
  }

  graph.on('tap', 'node', (evt: { target: CyElement }) => {
    deps.onTap(evt.target.data() as Record<string, unknown>);
  });
  graph.on('tap', (evt: { target: unknown }) => {
    if (evt.target === graph) graph.elements().unselect();
  });
  graph.on('mouseover', 'node', (evt: { target: CyElement & { data(key?: string): unknown; connectedEdges(): CyCollection; style(name: unknown): void } }) => {
    const node = evt.target;
    const accent = String(node.data('accentColor') || '#4F46E5');
    node.style({
      'border-width': 3,
      'border-color': accent,
      'border-opacity': 1,
      'overlay-color': accent,
      'overlay-opacity': 0.08,
      'overlay-padding': 10,
      'z-index': 998,
    });
    const connected = node.connectedEdges();
    graph.edges().not(connected).style('opacity', 0.2);
    connected.style({ 'opacity': 1, 'width': 3.5 });
  });
  graph.on('mouseout', 'node', (evt: { target: CyElement & { data(key?: string): unknown; style(name: unknown): void } }) => {
    const node = evt.target;
    const type = node.data('type');
    const defaultWidth = type === 'target' || type === 'vulnerability' ? 2 : 1.5;
    node.style({
      'border-width': defaultWidth,
      'border-color': String(node.data('accentColor') || '#94a3b8'),
      'border-opacity': 0.5,
      'overlay-opacity': 0,
      'overlay-padding': 0,
      'z-index': 0,
    });
    graph.edges().style({ 'opacity': 0.88, 'width': '' });
  });
  return graph;
}

/** Fits the graph into the container, keeping its zoom within a readable range. */
export function centerAttackChain(graph: CyGraph, deps: Pick<GraphViewDependencies, 'setTimer' | 'warn'>): void {
  try {
    const container = graph.container();
    if (!container) return;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      deps.setTimer(() => centerAttackChain(graph, deps), 100);
      return;
    }
    graph.fit(undefined, 60);
    deps.setTimer(() => {
      const currentZoom = graph.zoom() as number;
      const max = 1.25;
      const min = 0.25;
      let target = currentZoom;
      if (currentZoom > max) target = max;
      else if (currentZoom < min) target = min;
      if (Math.abs(target - currentZoom) > 0.01) {
        const extent = graph.extent();
        graph.zoom({ level: target, position: { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 } });
      }
      graph.center();
    }, 60);
  } catch (error) {
    deps.warn('Error while centering the graph:', error);
  }
}
