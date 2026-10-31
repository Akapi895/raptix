// Narrowing the attack-chain graph: by a search text (which highlights the matches), by a node type, or by a risk band.
// A node that is hidden takes its edges with it, and the view is fitted to what is left.

import type { CyCollection, CyElement, CyGraph } from './view';

export const RISK_RANGES: Record<string, [number, number]> = {
  'high': [80, 100],
  'medium-high': [60, 79],
  'medium': [40, 59],
  'low': [0, 39],
};

const FIT_PADDING = 60;

/** The two ends of an edge, or null when one of them is missing. */
function endsOf(edge: CyElement & { source?: () => CyCollection; target?: () => CyCollection }): { source: CyElement; target: CyElement } | null {
  try {
    const source = edge.source?.();
    const target = edge.target?.();
    if (!source || !target || !source.length || !target.length) return null;
    return { source: source as unknown as CyElement, target: target as unknown as CyElement };
  } catch {
    return null;
  }
}

/** Shows a node by its predicate; an edge is shown only while both of its ends are shown. */
export function applyVisibility(graph: CyGraph, visible: (node: CyElement) => boolean): void {
  graph.nodes().forEach(node => {
    node.style('display', visible(node) ? 'element' : 'none');
  });
  graph.edges().forEach(edge => {
    const ends = endsOf(edge);
    if (!ends) {
      edge.style('display', 'none');
      return;
    }
    const shown = ends.source.style('display') !== 'none' && ends.target.style('display') !== 'none';
    edge.style('display', shown ? 'element' : 'none');
  });
  graph.fit(undefined, FIT_PADDING);
}

/** Shows every node and edge again, with the default border. */
export function showAll(graph: CyGraph): void {
  graph.nodes().style('display', 'element');
  graph.edges().style('display', 'element');
  graph.nodes().style('border-width', 2);
  graph.fit(undefined, FIT_PADDING);
}

/** Highlights the nodes whose original label or type contains the text, and hides the rest. */
export function applySearch(graph: CyGraph, text: string): void {
  const search = text.toLowerCase().trim();
  if (search === '') {
    graph.nodes().style('display', 'element');
    graph.edges().style('display', 'element');
    graph.nodes().style('border-width', 2);
    return;
  }
  graph.nodes().forEach(node => {
    const label = String(node.data('originalLabel') || node.data('label') || '').toLowerCase();
    const type = String(node.data('type') || '').toLowerCase();
    if (label.includes(search) || type.includes(search)) {
      node.style('display', 'element');
      node.style('border-width', 4);
      node.style('border-color', '#0066ff');
    } else {
      node.style('display', 'none');
    }
  });
  graph.edges().forEach(edge => {
    const ends = endsOf(edge);
    if (!ends) {
      edge.style('display', 'none');
      return;
    }
    const shown = ends.source.style('display') !== 'none' && ends.target.style('display') !== 'none';
    edge.style('display', shown ? 'element' : 'none');
  });
  graph.fit(undefined, FIT_PADDING);
}

export function applyTypeFilter(graph: CyGraph, type: string): void {
  if (type === 'all') {
    showAll(graph);
    return;
  }
  applyVisibility(graph, node => String(node.data('type') || '') === type);
}

export function applyRiskFilter(graph: CyGraph, level: string): void {
  if (level === 'all') {
    showAll(graph);
    return;
  }
  const [min, max] = RISK_RANGES[level] ?? [0, 100];
  applyVisibility(graph, node => {
    const score = Number(node.data('riskScore') || 0);
    return score >= min && score <= max;
  });
}

/** The state after "reset": every node shown with its default border, every edge shown, the view fitted. */
export function resetFilters(graph: CyGraph): void {
  graph.nodes().forEach(node => {
    node.style('display', 'element');
    node.style('border-width', 2);
  });
  graph.edges().style('display', 'element');
  graph.fit(undefined, FIT_PADDING);
}
