import { describe, expect, it } from 'vitest';
import { createHttp } from '../../platform/http';
import { createDashboardClient } from './client';

describe('dashboard Go API boundary', () => {
  it('keeps original query contracts, scopes only access/token endpoints, and tolerates partial failure', async () => {
    const urls: string[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const transport = createHttp({ session: { read: () => null, clear() {} }, fetcher: async (input, init) => {
      const url = String(input); urls.push(url); signals.push(init?.signal);
      if (url === '/api/knowledge/stats') return new Response('{}', { status: 503 });
      return Response.json(url.startsWith('/api/vulnerabilities/stats') ? { total: 7, by_severity: { high: 7 }, by_status: { open: 7 } } : {});
    } });
    const controller = new AbortController();
    const response = await createDashboardClient(transport).load({ projectId: 'p /1', locale: 'en-US', status: 'confirmed', signal: controller.signal });
    expect(urls).toHaveLength(24);
    const scoped = urls.filter(url => url.includes('project_id='));
    expect(scoped.map(url => new URL(url, 'http://test').pathname)).toEqual(['/api/webshell/connections', '/api/c2/listeners', '/api/c2/sessions', '/api/c2/tasks', '/api/usage/tokens']);
    expect(scoped.every(url => new URL(url, 'http://test').searchParams.get('project_id') === 'p /1')).toBe(true);
    expect(urls).toContain('/api/vulnerabilities?severity=critical&status=open&limit=1');
    expect(urls).toContain('/api/vulnerabilities/stats?status=confirmed');
    expect(urls).toContain('/api/notifications/summary?since=0&limit=20&lang=en-US');
    expect(urls).toContain('/api/projects/dashboard-summary?fact_limit=10');
    expect(signals.every(signal => signal === controller.signal)).toBe(true);
    expect(response.knowledge).toBeNull(); expect(response.vulnerabilities?.by_severity).toEqual({ high: 7 });
  });
  it('does not issue a filtered statistics request when showing all statuses', async () => {
    const urls: string[] = [];
    const transport = createHttp({ session: { read: () => null, clear() {} }, fetcher: async input => { urls.push(String(input)); return Response.json({}); } });
    const response = await createDashboardClient(transport).load({ projectId: '', locale: 'zh-CN', status: '', signal: new AbortController().signal });
    expect(urls).toHaveLength(23); expect(urls.some(url => url.includes('project_id='))).toBe(false); expect(response.filteredSeverity).toBeNull();
  });
});
