import ELK from 'elkjs/lib/elk.bundled.js';
import type { Core } from 'cytoscape';
import type { FactGraph, GraphEdge } from './types';
import { pathGraphNodeLayer } from './service';

export async function layoutGraph(cy: Core, data: FactGraph, edges: GraphEdge[], center: () => void): Promise<void> {
  const complex = data.nodes.length > 15 || data.edges.length > 25;
  try {
    const layout = await new ELK().layout({ id: 'root', layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': complex ? '45' : '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': complex ? '70' : '95', 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    }, children: data.nodes.map(node => {
      const element = cy.getElementById(node.id);
      return { id: node.id, width: Number(element.data('nodeWidth')) || 340, height: Number(element.data('nodeHeight')) || 88,
        layoutOptions: { 'org.eclipse.elk.layered.layering.layerId': pathGraphNodeLayer(node.type, node.fact_key || node.id) } };
    }), edges: edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })) });
    if (cy.destroyed()) return;
    for (const node of layout.children ?? []) if (node.x != null && node.y != null) cy.getElementById(node.id).position({ x: node.x + (node.width ?? 0) / 2, y: node.y + (node.height ?? 0) / 2 });
    center();
  } catch {
    if (cy.destroyed()) return;
    const layout = cy.layout({ name: 'breadthfirst', directed: true, spacingFactor: complex ? 3 : 2.5, padding: 40 });
    layout.one('layoutstop', center); layout.run();
  }
}
