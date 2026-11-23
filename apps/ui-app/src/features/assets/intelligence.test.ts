import { describe, expect, it } from 'vitest';
import { buildAssetGraph, relatedFindings, summarizeAssets, targetHost } from './intelligence';
import { assetSchema } from '../../api/types/asset';
import { vulnerabilitySchema } from '../../api/types/vulnerability';

const asset = (id: string, fields = {}) => assetSchema.parse({ id, project_id: 'p1', host: '', domain: 'example.test', ip: '192.0.2.1', port: 443, protocol: 'https', server: 'nginx', title: '', country: '', province: '', city: '', responsible_person: '', department: '', business_system: '', environment: '', criticality: '', source: 'manual', source_query: '', status: 'active', tags: [], first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-31T00:00:00Z', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-31T00:00:00Z', risk_level: 'unassessed', vulnerability_count: 0, ...fields });
const finding = (id: string, fields = {}) => vulnerabilitySchema.parse({ id, project_id: 'p1', title: id, target: 'https://example.test/login', severity: 'high', status: 'open', conversation_id: '', description: '', type: '', preconditions: '', reproduction_steps: '', evidence: '', impact: '', recommendation: '', retest_notes: '', retest_log: '', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-31T00:00:00Z', ...fields });

describe('asset intelligence evidence', () => {
  it('counts discoveries by first seen, deduplicates endpoints, and distinguishes risk from scan coverage', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    const data = summarizeAssets([asset('old'), asset('new', { first_seen_at: '2026-10-30T12:00:00Z', risk_level: 'high', last_scan_at: '2026-09-01T00:00:00Z' }), asset('future', { first_seen_at: '2026-11-01T00:00:00Z' })], now);
    expect(data).toMatchObject({ total: 3, recent: 1, domains: 1, ips: 1, services: 1, highRisk: 1, scanned: 1, never: 2, stale: 1, coverage: 33 });
    expect(data.discoveries.map(a => a.id)).toEqual(['new']);
  });
  it('counts every recorded domain and address in a multi-name row, not the whole cell', () => {
    const data = summarizeAssets([asset('multi', { domain: 'a.test, b.test', ip: '192.0.2.5, 192.0.2.6' })]);
    expect(data).toMatchObject({ domains: 2, ips: 2 });
  });
  it('does not invent ports, DNS resolutions, services or findings for sparse records', () => {
    const graph = buildAssetGraph([asset('a', { domain: 'only.test', ip: '', port: 0, protocol: '', server: '' })]);
    expect(graph.nodes.map(n => [n.kind, n.label])).toEqual([['domain', 'only.test']]);
    expect(graph.edges).toEqual([]);
  });
  it('links findings only to their recorded project and target endpoint, not other ports or shared scan peers', () => {
    const graph = buildAssetGraph([asset('https'), asset('ssh', { port: 22, protocol: 'ssh', server: '', last_scan_conversation_id: 'shared' }), asset('other-project', { project_id: 'p2' })], [finding('match'), finding('wrong-target', { target: 'https://unrelated.test', conversation_id: 'shared' }), finding('wrong-port', { target: 'https://example.test:8443/' }), finding('other-project', { project_id: 'p3' })]);
    const findings = graph.nodes.filter(n => n.kind === 'vulnerability');
    expect(findings.map(n => n.findingId)).toEqual(['match']);
    expect(findings[0]?.assetIds).toEqual(['https']);
    expect(graph.edges.some(edge => edge.label === 'recorded address')).toBe(true);
    expect(graph.edges.some(edge => /resolves/i.test(edge.label))).toBe(false);
  });
  it('counts related findings with the same rule the detail panel uses: recorded target matches plus the latest linked scan', () => {
    const scanned = asset('scanned', { port: 22, protocol: 'ssh', server: '', last_scan_task_id: 'task-1' });
    const related = relatedFindings(scanned, [
      finding('target-match', { target: 'https://example.test/login' }),
      finding('same-task', { target: 'unrelated.test', task_id: 'task-1' }),
      finding('other-task', { target: 'unrelated.test', task_id: 'task-2' }),
      finding('other-project', { target: 'example.test', project_id: 'p2' }),
    ]);
    expect(related.findings.map(f => f.id)).toEqual(['same-task']);
    expect(relatedFindings(asset('https'), [finding('match')]).findings.map(f => f.id)).toEqual(['match']);
    expect(relatedFindings(asset('https'), [finding('match')]).matched.has('match')).toBe(true);
  });
  it('matches stored "<kind>:<target>" findings and bare hosts against any recorded address, but not another port of that host', () => {
    const hosts = asset('hosts', { domain: '', ip: '203.0.113.7', host: '203.0.113.9, 203.0.113.7', port: 0, protocol: '', server: '' });
    const graph = buildAssetGraph([hosts], [
      finding('net-tcp', { target: 'net:tcp://203.0.113.7:3306' }),
      finding('bare-second-address', { target: '203.0.113.9' }),
      finding('other-host', { target: 'net:tcp://203.0.113.8:3306' }),
    ]);
    expect(graph.nodes.filter(n => n.kind === 'vulnerability').map(n => n.findingId)).toEqual(['net-tcp', 'bare-second-address']);
    const pinned = asset('pinned', { domain: '', ip: '203.0.113.7', host: '203.0.113.7', port: 22, protocol: 'ssh', server: '' });
    expect(buildAssetGraph([pinned], [finding('https-same-host', { target: 'http:https://203.0.113.7/login' })]).nodes.some(n => n.kind === 'vulnerability')).toBe(false);
    expect(targetHost('http:https://www.example.test/wp-json/wp/v2/users')).toEqual({ host: 'www.example.test', port: 443 });
    expect(targetHost('net:tcp://203.0.113.7:3306')).toEqual({ host: '203.0.113.7', port: 3306 });
    expect(targetHost('203.0.113.9')).toEqual({ host: '203.0.113.9', port: 0 });
    expect(targetHost('  ')).toBeNull();
    const kgHost = asset('kg', { domain: 'ctsv.example.test', ip: '203.0.113.7', host: '203.0.113.7', port: 1800, protocol: 'tcp', server: 'tcp/1800 x; tcp/3306 mysql', source: 'neo4j-kg' });
    expect(relatedFindings(kgHost, [finding('mysql', { target: 'net:tcp://ctsv.example.test:3306' })]).findings.map(f => f.id)).toEqual(['mysql']);
  });
  it('keeps identical addresses separate across projects and connects a bare domain finding to the domain only', () => {
    const graph = buildAssetGraph([asset('a'), asset('b', { project_id: 'p2' })], [finding('domain-only', { target: 'example.test' })]);
    expect(graph.nodes.filter(n => n.kind === 'domain')).toHaveLength(2);
    const edge = graph.edges.find(edge => edge.label === 'finding target');
    expect(graph.nodes.find(n => n.id === edge?.source)?.kind).toBe('domain');
  });
});
