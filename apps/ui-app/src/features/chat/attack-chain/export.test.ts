import { describe, expect, it } from 'vitest';
import { buildAttackChainSvg, escapeXml, formatTimestamp, riskLabel, wrapLabel, type ExportData } from './export';

const chain: ExportData = {
  nodes: [
    { id: 't', x: 0, y: 0, type: 'target', riskScore: 0, label: '\u76ee\u6807\u7ad9\u70b9', metadata: { target: 'https://example.test' } },
    { id: 'a', x: 400, y: 0, type: 'action', riskScore: 0, label: 'nmap <scan>', metadata: { tool_name: 'nmap', findings: ['80/tcp open'] } },
    { id: 'v', x: 800, y: 0, type: 'vulnerability', riskScore: 85, label: 'SQL \u6ce8\u5165', metadata: { severity: 'critical', vulnerability_type: 'sqli' } },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'a', sx: 0, sy: 0, tx: 400, ty: 0, type: 'targets' },
    { id: 'e2', source: 'a', target: 'v', sx: 400, sy: 0, tx: 800, ty: 0, type: 'discovers' },
  ],
};

describe('attack chain export', () => {
  it('escapes the markup characters of a text', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
    expect(escapeXml(null)).toBe('');
  });

  it('names a risk by its band, and says nothing when there is no risk', () => {
    expect([riskLabel(90), riskLabel(70), riskLabel(50), riskLabel(10), riskLabel(0)]).toEqual(['Critical', 'High', 'Medium', 'Low', '']);
  });

  it('breaks a label at a space near the cut, and ends the last line with an ellipsis when it runs out', () => {
    expect(wrapLabel('short', 20, 2)).toEqual(['short']);
    const lines = wrapLabel('alpha beta gamma delta epsilon zeta eta theta iota kappa', 10, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('formats the report time to the minute, in the local calendar', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 59))).toBe('2026-01-02 03:04');
  });

  it('builds a self-contained SVG with the counts, the escaped labels and every edge', () => {
    const svg = buildAttackChainSvg(chain, '2026-01-02 03:04');
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('Attack Chain Visualization Report');
    expect(svg).toContain('2026-01-02 03:04');
    expect(svg).toContain('nmap &lt;scan&gt;');
    expect(svg).not.toContain('nmap <scan>');
    expect(svg).toContain('url(#ac-edge-grad-0)');
    expect(svg).toContain('url(#ac-edge-grad-1)');
    expect(svg).toContain('Critical · 85');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('refuses to report a chain with no node', () => {
    expect(() => buildAttackChainSvg({ nodes: [], edges: [] }, 'now')).toThrow('No data to export');
  });
});
