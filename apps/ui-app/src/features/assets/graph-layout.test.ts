import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { assetGraphLayout, compactGraphLayers } from './graph-layout';

describe('asset graph layout', () => {
  for (const count of [5, 50, 200]) {
    it(`separates ${count} connected and disconnected nodes`, () => {
      const nodes = Array.from({ length: count }, (_, i) => ({ data: { id: `n${i}` } }));
      const edges = Array.from({ length: count }, (_, i) => i % 5 === 0 ? null : ({ data: { id: `e${i}`, source: `n${i - 1}`, target: `n${i}` } })).filter(edge => edge !== null);
      const cy = cytoscape({ headless: true, styleEnabled: true, elements: [...nodes, ...edges], style: [{ selector: 'node', style: { width: 156, height: 36 } }] });
      cy.layout(assetGraphLayout).run(); compactGraphLayers(cy);
      const positioned = cy.nodes().toArray();
      for (let i = 0; i < positioned.length; i++) for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i]!.position(), b = positioned[j]!.position();
        expect(Math.abs(a.x - b.x) >= 156 || Math.abs(a.y - b.y) >= 36).toBe(true);
      }
      expect(cy.edges()).toHaveLength(edges.length);
      cy.destroy();
    });
  }
});
