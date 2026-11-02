import type { Core, LayoutOptions } from 'cytoscape';

export const assetGraphLayout: LayoutOptions = {
  name: 'breadthfirst', directed: true, animate: false, padding: 40,
  spacingFactor: 1.35, avoidOverlap: true, fit: false,
};

export function compactGraphLayers(cy: Core) {
  // Breadthfirst uses the wider node dimension for vertical spacing too.
  const layers = [...new Set(cy.nodes().map(node => node.position('y')))].sort((a, b) => a - b);
  cy.nodes().forEach(node => { node.position('y', layers.indexOf(node.position('y')) * 100); });
}
