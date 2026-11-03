import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuthedTestApp } from '../support/build-test-app.js';
import { FakeRuntime } from '../support/fake-runtime.js';
import { FakeAppConfigStore } from '../support/fake-app-config-store.js';
import { SpecialistConfigurationService } from '../../src/services/specialist-configuration.js';

const additions = { skills: ['/skills/standard/analyst/sql-injection/SKILL.md'], tools: ['tool:solidity_scan'], mcp: ['mcp:controlled:echo_marker'] };
const capability = (id: string) => ({ id, name: id, description: '', source: 'controlled-test', installed: true, available: true, status: 'available', requirements: [] });
const catalog = { specialist_id: 'recon', builtins: { tools: ['bash', 'load_skill'], skills: [], skill_sources: [], behavior: 'Reconnaissance' }, skills: additions.skills.map(capability), tools: additions.tools.map(capability), servers: [{ id: 'controlled', available: true, tools: additions.mcp.map(capability) }] };

describe('persistent specialist configuration admission', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  it('saves global/project additions, isolates project B, retains run snapshots and restores after rebuilding the backend', async () => {
    const runtime = new FakeRuntime(); runtime.specialistCatalog = catalog;
    const store = new FakeAppConfigStore();
    let built = await buildAuthedTestApp({ runtime, appConfigStore: store }); app = built.app;
    let headers = { authorization: 'Bearer ' + built.token };
    const a = (await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'A' } })).json().id;
    const b = (await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'B' } })).json().id;
    const url = '/api/specialists/recon/configuration';
    expect((await app.inject({ method: 'PUT', url, headers, payload: { revision: 0, additions: { skills: [], tools: additions.tools, mcp: [] } } })).statusCode).toBe(200);
    const response = await app.inject({ method: 'PUT', url: url + '?project_id=' + a, headers, payload: { revision: 1, additions } });
    expect(response.statusCode).toBe(200); expect(response.json().effective).toEqual(additions);
    const effectiveB = (await app.inject({ method: 'GET', url: url + '?project_id=' + b, headers })).json();
    expect(effectiveB.effective).toEqual({ skills: [], tools: additions.tools, mcp: [] });
    const service = new SpecialistConfigurationService(store, runtime);
    const old = await service.snapshot(a);
    runtime.queueRunStatuses('success');
    await app.inject({ method: 'POST', url: '/api/eino-agent', headers, payload: { message: 'Local probe', projectId: a, role: 'recon' } });
    expect(runtime.createdRuns[0].assistantId).toBe('recon');
    expect((runtime.createdRuns[0].config?.configurable as Record<string, unknown>).specialist_configuration).toEqual(old);
    const cleared = { skills: [], tools: [], mcp: [] };
    expect((await app.inject({ method: 'PUT', url: url + '?project_id=' + a, headers, payload: { revision: 2, additions: cleared } })).statusCode).toBe(200);
    expect(old.specialists.recon.skills).toEqual(additions.skills);
    expect((await service.snapshot(a)).specialists.recon.skills).toEqual([]);
    await app.close();
    built = await buildAuthedTestApp({ runtime, appConfigStore: store, projectStore: built.options.projectStore }); app = built.app;
    headers = { authorization: 'Bearer ' + built.token };
    const restored = (await app.inject({ method: 'GET', url: url + '?project_id=' + a, headers })).json();
    expect(restored.revision).toBe(3); expect(restored.effective).toEqual({ skills: [], tools: additions.tools, mcp: [] });
  });

  it('rejects duplicate/unknown IDs, stale revisions, missing projects and unauthenticated writes', async () => {
    const runtime = new FakeRuntime(); runtime.specialistCatalog = catalog;
    const built = await buildAuthedTestApp({ runtime }); app = built.app;
    const headers = { authorization: 'Bearer ' + built.token };
    const url = '/api/specialists/recon/configuration';
    const write = (payload: Record<string, unknown>, suffix = '') => app.inject({ method: 'PUT', url: url + suffix, headers, payload });
    expect((await app.inject({ method: 'PUT', url, payload: { revision: 0, additions } })).statusCode).toBe(401);
    expect((await write({ revision: 0, additions: { ...additions, tools: ['tool:invented'] } })).statusCode).toBe(400);
    expect((await write({ revision: 0, additions: { ...additions, tools: [...additions.tools, ...additions.tools] } })).statusCode).toBe(400);
    expect((await write({ revision: 0, additions }, '?project_id=missing')).statusCode).toBe(404);
    expect((await write({ revision: 'invalid', additions })).statusCode).toBe(400);
    expect((await write({ revision: 0, additions })).statusCode).toBe(200);
    expect((await write({ revision: 0, additions })).statusCode).toBe(409);
    runtime.specialistCatalog = { ...catalog, servers: [] };
    const unavailable = (await app.inject({ method: 'GET', url, headers })).json();
    expect(unavailable.status).toBe('unavailable'); expect(unavailable.diagnostics[0].id).toBe(additions.mcp[0]);
  });
});
