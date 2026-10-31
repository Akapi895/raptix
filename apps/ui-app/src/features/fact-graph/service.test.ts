import { describe, expect, it } from 'vitest';
import { resolveGraphNodeType, pathGraphNodeLayer, type GraphNode } from './index';
import { buildNodeCard, wrapTextLines } from './cards';

const node = (changes: Partial<GraphNode>): GraphNode => ({ id: 'note/a', fact_key: '', category: '', label: '', summary: '', confidence: 'confirmed', type: '', pinned: false, ...changes });
describe('public fact graph rules and visual cards', () => {
  it('prioritizes synthetic vulnerabilities and category before fallback type/key', () => {
    expect(resolveGraphNodeType(node({ fact_key: 'vuln:1', category: 'target' }))).toBe('vulnerability');
    expect(resolveGraphNodeType(node({ category: 'auth', type: 'finding' }))).toBe('auth');
    expect(resolveGraphNodeType(node({ category: 'vuln' }))).toBe('vulnerability');
    expect(resolveGraphNodeType(node({ fact_key: 'evidence/test' }))).toBe('exploit');
    expect(pathGraphNodeLayer('target', 'target/test')).toBe('0'); expect(pathGraphNodeLayer('finding', 'vuln:1')).toBe('4');
  });
  it('wraps CJK, ellipsizes long keys and preserves card dimensions, palettes and escaped content', () => {
    expect(wrapTextLines('\u4e2d'.repeat(100), 100, 13, 2, true)).toHaveLength(2);
    expect(wrapTextLines('\u4e2d'.repeat(100), 100, 13, 2, true)[1]).toContain('…');
    const card = buildNodeCard('target', '<script>alert("x")</script>', 'tentative', 'target/a', false);
    expect(card.nodeWidth).toBe(380); expect(card.nodeHeight).toBeGreaterThanOrEqual(88); expect(card.nodeHeight).toBeLessThanOrEqual(176);
    const svg = decodeURIComponent(card.cardSvgUrl.split(',')[1] || ''); expect(svg).toContain('&lt;script&gt;'); expect(svg).not.toContain('<script>'); expect(svg).toContain('stroke-dasharray="8 5"');
    expect(buildNodeCard('note', 'x', 'deprecated', '', true).theme.bgStart).toBe('#1e293b');
  });
});
