import { describe, expect, it } from 'vitest';
import { buildGraphElements, isComplexGraph, nodeBadge, nodeTheme, shortenNodeLabels, truncateNodeLabel } from './graph-model';

describe('attack chain graph model', () => {
  it('shortens a long label at a punctuation mark when it is near the cut', () => {
    expect(truncateNodeLabel('\u77ed\u6807\u9898', false)).toBe('\u77ed\u6807\u9898');
    expect(truncateNodeLabel('\u626b\u63cf\u76ee\u6807\u7f51\u7ad9\uff0c\u53d1\u73b0\u767b\u5f55\u5165\u53e3\u548c\u63a5\u53e3\u6587\u6863\u5185\u5bb9\u5e76\u9a8c\u8bc1\u6743\u9650', false)).toBe('\u626b\u63cf\u76ee\u6807\u7f51\u7ad9\uff0c\u53d1\u73b0\u767b\u5f55\u5165\u53e3\u548c\u63a5\u53e3\u6587\u6863\u5185\u5bb9\u5e76\u9a8c...');
    expect(truncateNodeLabel('Scan the target site, then check the login page', false)).toBe('Scan the target site, ...');
    expect(truncateNodeLabel('x'.repeat(30), true)).toBe('x'.repeat(18) + '...');
  });

  it('shortens the node labels in place, as the page always did', () => {
    const nodes = [{ id: 'a', label: 'x'.repeat(30) }, { id: 'b' }];
    shortenNodeLabels(nodes, true);
    expect(nodes[0]?.label).toBe('x'.repeat(18) + '...');
    expect(nodes[1]?.label).toBeUndefined();
  });

  it('colours a vulnerability by its risk, and a productive action by its findings', () => {
    expect(nodeTheme({ id: 'v', type: 'vulnerability', risk_score: 85 }, false)).toMatchObject({ typeEn: 'VULNERABILITY', accentColor: '#E11D48', iconType: 'vulnerability' });
    expect(nodeTheme({ id: 'v', type: 'vulnerability', risk_score: 10 }, false).accentColor).toBe('#0D9488');
    expect(nodeTheme({ id: 'a', type: 'action', metadata: { findings: [1] } }, false).accentColor).toBe('#10B981');
    expect(nodeTheme({ id: 'a', type: 'action', metadata: { findings: [1], status: 'failed_insight' } }, false).accentColor).toBe('#64748B');
  });

  it('uses the dark surface and light text on a dark theme', () => {
    const dark = nodeTheme({ id: 't', type: 'target' }, true);
    expect(dark).toMatchObject({ bgGradientStart: '#111827', bgGradientEnd: '#1E1B4B', labelTextColor: '#E5E7EB', typeColor: '#E5E7EB' });
  });

  it('writes the badge of a node by its kind', () => {
    expect(nodeBadge({ id: 'v', type: 'vulnerability', risk_score: 65 })).toBe('High · 65');
    expect(nodeBadge({ id: 'a', type: 'action', metadata: { findings: [1, 2] } })).toBe('Found 2');
    expect(nodeBadge({ id: 'a', type: 'action', metadata: { status: 'failed_insight' } })).toBe('Leads only');
    expect(nodeBadge({ id: 't', type: 'target' })).toBe('Primary target');
    expect(nodeBadge({ id: 'x', type: 'other' })).toBe('');
  });

  it('builds a node for each node and an edge only where both ends exist', () => {
    const built = buildGraphElements(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', type: 'target' }],
      [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'a', target: 'missing', weight: 3 }],
      false,
    );
    expect(built.elements).toHaveLength(3);
    expect(built.validEdges.map(edge => edge.id)).toEqual(['e1']);
    expect(built.skipped).toEqual([{ edgeId: 'e2', source: 'a', target: 'missing', sourceExists: true, targetExists: false }]);
    expect(built.elements[2]?.data).toMatchObject({ id: 'e1', source: 'a', target: 'b', type: 'leads_to', weight: 1 });
  });

  it('calls a graph complex past fifteen nodes or twenty-five edges', () => {
    expect(isComplexGraph(15, 25)).toBe(false);
    expect(isComplexGraph(16, 1)).toBe(true);
    expect(isComplexGraph(1, 26)).toBe(true);
  });
});
