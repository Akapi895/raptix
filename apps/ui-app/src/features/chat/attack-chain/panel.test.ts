import { describe, expect, it } from 'vitest';
import { nodeDetailHtml, nodeTypeLabel, severityColor, statsText } from './panel';

describe('attack chain panel', () => {
  it('colours a severity and falls back to grey for an unknown one', () => {
    expect(severityColor('Critical')).toBe('#ff0000');
    expect(severityColor('low')).toBe('#ffbb00');
    expect(severityColor('unknown')).toBe('#666');
    expect(severityColor(undefined)).toBe('#666');
  });

  it('names a node kind in the reader language, and keeps an unknown kind as it is', () => {
    expect(nodeTypeLabel('action')).toBe('Action');
    expect(nodeTypeLabel('vulnerability')).toBe('Vulnerability');
    expect(nodeTypeLabel('target')).toBe('Target');
    expect(nodeTypeLabel('other')).toBe('other');
  });

  it('writes the counts through the translation, or in English when there is none', () => {
    const chain = { nodes: [{}, {}], edges: [{}] };
    expect(statsText(chain, (key, values) => `${key} ${values.nodes}/${values.edges}`)).toBe('attackChainModal.nodesEdges 2/1');
    expect(statsText(chain, () => undefined)).toBe('Nodes: 2 | Edges: 1');
    expect(statsText({}, () => undefined)).toBe('Nodes: 0 | Edges: 0');
  });

  it('escapes the text of a vulnerability and shows its severity colour', () => {
    const html = nodeDetailHtml({
      id: 'v1',
      type: 'vulnerability',
      label: 'XSS',
      riskScore: 80,
      metadata: { vulnerability_type: '<script>x</script>', severity: 'high', location: '/a?b=1&c=2' },
    });
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('color: #ff4444');
    expect(html).toContain('/a?b=1&amp;c=2');
    expect(html).not.toContain('<script>x</script>');
  });

  it('lists the findings of an action, escaped', () => {
    const html = nodeDetailHtml({ id: 'a1', type: 'action', label: 'scan', riskScore: 0, metadata: { tool_name: 'nmap', findings: ['<b>open</b>'] } });
    expect(html).toContain('<li>&lt;b&gt;open&lt;/b&gt;</li>');
    expect(html).toContain('<code>nmap</code>');
  });

  it('marks an action that failed but left a clue', () => {
    const html = nodeDetailHtml({ id: 'a2', type: 'action', riskScore: 0, metadata: { status: 'failed_insight' } });
    expect(html).toContain('Failed with leads');
  });
});
