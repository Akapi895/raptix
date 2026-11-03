import type { SpecialistAdditions, SpecialistCatalog, SpecialistConfiguration, SpecialistSelection, SpecialistSnapshot } from '@raptix/web-contracts';
import type { AppConfigStore } from '../db/app-config-store.js';
import type { RuntimeTransport } from '../adapters/runtime/client.js';

const KEY = 'specialist-capabilities-v1';
const empty = (): SpecialistAdditions => ({ skills: [], tools: [], mcp: [] });
const merge = (a: SpecialistAdditions, b: SpecialistAdditions): SpecialistAdditions => ({
  skills: [...new Set([...a.skills, ...b.skills])].sort(), tools: [...new Set([...a.tools, ...b.tools])].sort(), mcp: [...new Set([...a.mcp, ...b.mcp])].sort(),
});
interface SavedSelection extends SpecialistAdditions { revision: number }
interface Document { revision: number; scopes: Record<string, Record<string, SavedSelection>> }
export class SpecialistConfigConflict extends Error {}

/** One atomic document provides a consistent global/project snapshot at run admission. */
export class SpecialistConfigurationService {
  public constructor(private readonly store: AppConfigStore, private readonly runtime: RuntimeTransport) {}

  private async document(): Promise<{ raw: Record<string, unknown> | null; saved: Document }> {
    const raw = await this.store.get(KEY);
    return { raw, saved: raw ? raw as unknown as Document : { revision: 0, scopes: {} } };
  }

  public async read(specialistId: string, projectId: string | null, catalog: SpecialistCatalog): Promise<SpecialistConfiguration> {
    const { saved } = await this.document();
    const global = saved.scopes.global?.[specialistId] ?? { ...empty(), revision: 0 };
    const project = projectId ? saved.scopes['project:' + projectId]?.[specialistId] ?? { ...empty(), revision: 0 } : { ...empty(), revision: 0 };
    const effective = merge(global, project);
    const known = { skills: new Set(catalog.skills.filter(c => c.available).map(c => c.id)), tools: new Set(catalog.tools.filter(c => c.available).map(c => c.id)), mcp: new Set(catalog.servers.flatMap(s => s.available ? s.tools.filter(c => c.available).map(c => c.id) : [])) };
    const diagnostics = (['skills', 'tools', 'mcp'] as const).flatMap(kind => effective[kind].filter(id => !known[kind].has(id)).map(id => ({ id, kind, status: 'unavailable', message: 'Not available in the current runtime catalog. Restore the dependency/connection or remove this addition.' })));
    return { specialist_id: specialistId, project_id: projectId, revision: saved.revision,
      global: merge(empty(), global), project: merge(empty(), project), global_revision: global.revision,
      project_revision: project.revision, effective, builtins: catalog.builtins,
      resolved: merge({ skills: catalog.builtins.skills, tools: catalog.builtins.tools.map(name => 'tool:' + name), mcp: [] }, effective),
      diagnostics, status: diagnostics.length ? 'unavailable' : 'ready_for_new_run' };
  }

  public async update(specialistId: string, projectId: string | null, additions: SpecialistAdditions, expectedRevision: number): Promise<void> {
    const { raw, saved } = await this.document();
    if (saved.revision !== expectedRevision) throw new SpecialistConfigConflict('Configuration changed. Reload before saving.');
    await this.runtime.specialistRequest('/_raptix/specialists/validate', { specialist_id: specialistId, additions });
    const scope = projectId ? 'project:' + projectId : 'global';
    const revision = saved.revision + 1;
    const next = { revision, scopes: { ...saved.scopes, [scope]: { ...saved.scopes[scope], [specialistId]: { ...merge(empty(), additions), revision } } } };
    if (!await this.store.compareAndSet(KEY, raw, next)) throw new SpecialistConfigConflict('Configuration changed. Reload before saving.');
  }

  public async snapshot(projectId: string | null): Promise<SpecialistSnapshot> {
    const { saved } = await this.document();
    const global = saved.scopes.global ?? {};
    const project = projectId ? saved.scopes['project:' + projectId] ?? {} : {};
    const specialists: Record<string, SpecialistSelection> = {};
    for (const id of new Set([...Object.keys(global), ...Object.keys(project)])) {
      const additions = merge(global[id] ?? empty(), project[id] ?? empty());
      if (additions.skills.length || additions.tools.length || additions.mcp.length) specialists[id] = {
        ...additions, global_revision: global[id]?.revision ?? 0, project_revision: project[id]?.revision ?? 0,
      };
    }
    return structuredClone({ version: 1, revision: saved.revision, project_id: projectId, specialists });
  }
}
