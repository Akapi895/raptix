import { describe, expect, it, vi } from 'vitest';
import { createSkillsService } from './index';
import type { RequestFn } from './service';
import type { KeyValueStorage } from '../../platform/storage';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function setup(responder: RequestFn, saved = '20') {
  const values = new Map([['skillsPageSize', saved]]);
  const storage: KeyValueStorage = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true; }, remove: key => values.delete(key) };
  const request = vi.fn(responder);
  return { service: createSkillsService({ request, storage }), request, values };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('skills public service', () => {
  it('uses limit/offset, persists supported sizes, clamps the current page and searches all results', async () => {
    const { service, request, values } = setup(async () => response({ skills: [], total: 41 }), '10');
    await service.load(5);
    expect(request.mock.calls[0]?.[0]).toBe('/api/skills?limit=10&offset=40');
    await service.changePageSize(50);
    expect(values.get('skillsPageSize')).toBe('50'); expect(service.state.page).toBe(1);
    await service.load(1, 50, ' quote & search ');
    expect(request.mock.lastCall?.[0]).toBe('/api/skills?limit=10000&offset=0&search=quote+%26+search');
    expect(await service.changePageSize(9)).toBe(false);
  });
  it('rejects invalid persisted sizes', () => { expect(setup(async () => response({}), '999').service.state.pageSize).toBe(20); });
  it('a stale list response cannot replace the latest search', async () => {
    const first = deferred<Response>(); const { service } = setup(async path => path.includes('search=') ? response({ skills: [{ name: 'new' }], total: 1 }) : first.promise);
    const old = service.load(); await service.load(1, 20, 'new'); first.resolve(response({ skills: [{ name: 'old' }], total: 1 }));
    expect(await old).toBe(false); expect(service.state.skills[0]?.name).toBe('new');
  });
  it('a stale failed list response cannot replace a successful newer list with an error state', async () => {
    const pending = deferred<Response>(); const { service } = setup(async path => path.includes('search=') ? response({ skills: [{ name: 'fresh' }], total: 1 }) : pending.promise);
    const load = service.load(); await service.load(1, 20, 'fresh'); pending.resolve(response({ error: 'old failure' }, 500));
    expect(await load).toBe(false); expect(service.state.skills[0]?.name).toBe('fresh');
  });
  it.each([true, false])('accepts Go wrapped and demo flat details (wrapped=%s), and both file list forms', async wrapped => {
    const skill = { name: 'sample', content: 'body', description: 'description' };
    const { service } = setup(async path => response(path.endsWith('/files') ? { files: wrapped ? [{ path: 'SKILL.md', is_dir: false }] : ['SKILL.md'] } : wrapped ? { skill } : skill));
    await service.beginEdit('sample'); expect(service.state.editor).toMatchObject({ name: 'sample', content: 'body', files: [{ path: 'SKILL.md' }] });
  });
  it('keeps the editor usable if optional package-file listing is unavailable', async () => {
    const { service } = setup(async path => path.endsWith('/files') ? response({ error: 'missing' }, 404) : response({ skill: { name: 'sample' } }));
    await service.beginEdit('sample'); expect(service.state.editor?.files).toEqual([]);
  });
  it('does not reopen an editor after it was closed during a detail request', async () => {
    const pending = deferred<Response>(); const { service } = setup(async path => path.endsWith('/files') ? response({ files: [] }) : pending.promise);
    const edit = service.beginEdit('sample'); service.closeEditor(); pending.resolve(response({ skill: { name: 'sample' } }));
    expect(await edit).toBe(false); expect(service.state.editor).toBeNull();
  });
  it('validates creation and saves standard metadata/body with one request despite duplicate submissions', async () => {
    const pending = deferred<Response>(); const { service, request } = setup(async () => pending.promise);
    service.beginCreate(); await expect(service.save()).rejects.toThrow('skills.nameRequired');
    service.updateEditor('name', 'Invalid_Name'); await expect(service.save()).rejects.toThrow('skills.nameInvalid');
    service.updateEditor('name', 'new-skill'); await expect(service.save()).rejects.toThrow('skills.descriptionRequired');
    service.updateEditor('description', ' desc '); await expect(service.save()).rejects.toThrow('skills.contentRequired');
    service.updateEditor('content', ' body '); const save = service.save(); expect(await service.save()).toBe('busy');
    expect(JSON.parse(String(request.mock.lastCall?.[1]?.body))).toEqual({ name: 'new-skill', description: 'desc', content: 'body' });
    pending.resolve(response({})); expect(await save).toBe('created'); expect(service.state.editor).toBeNull(); expect(service.state.saving).toBe(false);
  });
  it('requires saving description on SKILL.md first and preserves raw non-markdown file contents', async () => {
    const { service, request } = setup(async (path, init) => response(init ? {} : path.endsWith('/files') ? { files: ['SKILL.md'] } : { skill: { name: 'sample', content: 'body' } }));
    await service.beginEdit('sample'); service.updateEditor('description', 'new desc');
    await expect(service.selectFile('scripts/run.py', true)).rejects.toThrow('skillModal.saveDescriptionFirst');
    await service.save(); await service.selectFile('scripts/run.py', true); service.updateEditor('content', '\n  print(1)\n'); await service.save();
    const call = request.mock.calls.find(([path, init]) => path.endsWith('/file') && init?.method === 'PUT');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ path: 'scripts/run.py', content: '\n  print(1)\n' });
  });
  it('encodes IDs and paths and prevents a late file read from overwriting the newer file', async () => {
    const pending = deferred<Response>(); const { service, request } = setup(async path => path.endsWith('/files') ? response({ files: [] }) : path.includes('/file?') ? pending.promise : response({ skill: { name: 'sample', content: 'markdown' } }));
    await service.beginEdit('sample'); const old = service.selectFile('a & b.txt'); await service.selectFile('new.txt', true); pending.resolve(response({ content: 'old' }));
    expect(await old).toBe(false); expect(service.state.editor).toMatchObject({ path: 'new.txt', content: '', fileDirty: true });
    expect(request.mock.calls.some(([path]) => path.includes('path=a%20%26%20b.txt'))).toBe(true);
    await expect(service.selectFile('../oops')).rejects.toThrow('skillModal.newFilePathInvalid');
  });
  it('keeps dirty drafts and clears saving state on server and non-JSON errors', async () => {
    const { service } = setup(async () => new Response('bad gateway', { status: 502 }));
    service.beginCreate(); service.updateEditor('name', 'sample'); service.updateEditor('description', 'desc'); service.updateEditor('content', 'draft');
    await expect(service.save()).rejects.toThrow('skills.saveFailed'); expect(service.state.saving).toBe(false); expect(service.state.editor?.content).toBe('draft');
    const other = setup(async () => response({ error: 'cannot write file' }, 403));
    await expect(other.service.remove('sample')).rejects.toThrow('cannot write file');
  });
  it('checks both bound-role response shapes and preserves affected-role deletion feedback', async () => {
    const { service, request } = setup(async (path, init) => response(init ? { affected_roles: ['role'] } : path.includes('go') ? { bound_roles: ['go-role'] } : { roles: ['demo-role'] }));
    expect(await service.boundRoles('go')).toEqual(['go-role']); expect(await service.boundRoles('demo')).toEqual(['demo-role']);
    expect(await service.remove('quote / name')).toEqual(['role']); expect(request.mock.lastCall?.[0]).toBe('/api/skills/quote%20%2F%20name');
  });
  it('normalizes Go and demo stats without inventing successes, and clears via DELETE', async () => {
    const go = setup(async () => response({ total_skills: 3, total_calls: 10, total_success: 8, total_failed: 2, skills_dir: '/skills', stats: [] }));
    await go.service.loadMonitor(); expect(go.service.state.stats).toMatchObject({ total: 3, totalCalls: 10, totalSuccess: 8, totalFailed: 2 });
    const demo = setup(async () => response({ total: 2, invocations: 8, by_skill: [{ name: 'sample', invocations: 4 }] }));
    await demo.service.loadMonitor(); expect(demo.service.state.stats.stats[0]).toMatchObject({ skill_name: 'sample', total_calls: 4, success_calls: 0 });
    await demo.service.clearStats(); expect(demo.request.mock.lastCall).toEqual(['/api/skills/stats', { method: 'DELETE' }]);
  });
  it('ignores outstanding reads on disposal', async () => {
    const pending = deferred<Response>(); const { service } = setup(async () => pending.promise);
    const load = service.load(); service.dispose(); pending.resolve(response({ skills: [{ name: 'late' }], total: 1 }));
    expect(await load).toBe(false); expect(service.state.skills).toEqual([]);
  });
});
