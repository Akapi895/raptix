/** Demo-only fixtures; production catalogs are resolved by the Python runtime. */
import { z } from 'zod';
import type { SpecialistAdditions, SpecialistCatalog } from '@raptix/web-contracts';
import type { MockRuntime } from '../runtime';

export function registerSpecialistFixtures(M: MockRuntime): void {
  const empty = (): SpecialistAdditions => ({ skills: [], tools: [], mcp: [] });
  const cap = (id: string, name: string) => ({ id, name, description: 'Local demo fixture for specialist configuration.', source: 'Demo fixture', installed: true, available: true, status: 'available', requirements: [] });
  const catalog = (id: string): SpecialistCatalog => ({
    specialist_id: id, builtins: { tools: ['bash', 'load_skill'], skills: [], skill_sources: [], behavior: 'Built-in specialist behavior is retained.' },
    skills: [cap('/skills/standard/analyst/sql-injection/SKILL.md', 'SQL injection')], tools: [cap('tool:solidity_scan', 'solidity_scan')],
    servers: [{ id: 'controlled', name: 'Controlled demo MCP', installed: true, configured: true, enabled: true, reachable: true, available: true, status: 'connected', requirements: [], tools: [cap('mcp:controlled:echo_marker', 'echo_marker')] }],
  });
  const document = () => M.state.specialistConfigurations ??= { revision: 0, scopes: {} };
  const schema = z.object({ revision: z.number().int().min(0), additions: z.object({ skills: z.array(z.string()), tools: z.array(z.string()), mcp: z.array(z.string()) }) });
  const configuration = (id: string, project: string) => {
    const saved = document(); const global = saved.scopes['global:' + id] ?? empty(); const local = saved.scopes[project + ':' + id] ?? empty();
    const effective = { skills: [...new Set([...global.skills, ...local.skills])], tools: [...new Set([...global.tools, ...local.tools])], mcp: [...new Set([...global.mcp, ...local.mcp])] };
    return { specialist_id: id, project_id: project || null, revision: saved.revision, global, project: local, global_revision: saved.revision, project_revision: saved.revision, effective, builtins: catalog(id).builtins, resolved: { ...effective, tools: [...new Set(['tool:bash', 'tool:load_skill', ...effective.tools])] }, diagnostics: [], status: 'ready_for_new_run' };
  };
  M.route('GET', '/api/specialists/:id/catalog', ctx => M.ok(catalog(ctx.params.id!)));
  M.route('GET', '/api/specialists/:id/configuration', ctx => M.ok(configuration(ctx.params.id!, M.q(ctx, 'project_id', ''))));
  M.route('PUT', '/api/specialists/:id/configuration', schema, ctx => {
    const saved = document(); if (ctx.body.revision !== saved.revision) return M.fail(409, 'Configuration changed. Reload before saving.');
    const project = M.q(ctx, 'project_id', '');
    saved.scopes[(project || 'global') + ':' + ctx.params.id] = ctx.body.additions;
    saved.revision++; M.save(); return M.ok(configuration(ctx.params.id!, project));
  });
}
