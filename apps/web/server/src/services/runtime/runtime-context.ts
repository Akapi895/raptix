import * as path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import type { ProjectViewModel, ThreadKind, RuntimeContextView } from '@raptix/web-contracts';
import type { RuntimeConfig } from '../../config/runtime.js';
import type { RuntimeReadPort } from '../../integrations/runtime/read-client.js';
import type { RuntimeRouter } from '../../integrations/runtime/runtime-router.js';
import { RuntimeUnavailableError } from '../../integrations/runtime/read-client.js';
import { assertProjectTarget, ProjectPolicyError } from '../../security/project-policy.js';
import { resolveEngagementWorkspaceDir } from '../../security/workspace-policy.js';
import { requestFingerprint } from '../../security/request-fingerprint.js';
import { sandboxUrlFor } from './sandbox-routing.js';
import { environmentSandboxUrlFor } from '../environments/project-environment-service.js';
import type { ProjectsService } from '../projects-service.js';
import type { RuntimeOwnershipService } from '../runtime-ownership.js';

export interface ContextSelection { kind: ThreadKind; assistantId?: string; threadId?: string }
/** The singular planning assistant graph. */
export const PLANNING_ASSISTANT = 'soundwave';
/** Assistant graphs accepted for execution threads, in preference order. */
// New execution threads use the delta-messages graph; threads created before it stay bound to 'raptix'.
export const EXECUTION_ASSISTANTS = ['raptix-delta', 'raptix', 'decepticon'] as const;
export interface TrustedRuntimeContext {
  engagementId: string; workspaceSlug: string; assistantId: string; kind: ThreadKind
  configurable: { engagement_name: string; workspace_path: string; target_type: ProjectViewModel['targetType']; target_value: string; authorization_confirmed: boolean; language?: string; sandbox_url?: string; hitl_enabled?: false }
  runtimeConfigHash: string; bindingHash: string; metadata: Record<string, string>
  publicView: RuntimeContextView
}
const mismatch = (): ProjectPolicyError => new ProjectPolicyError('conflict', 'Thread assistant, workspace or hydrated context does not match this engagement');
export function parseContextSelection(raw: unknown): ContextSelection {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProjectPolicyError('bad_request', 'Invalid runtime context selection');
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some(k => !['kind', 'assistantId', 'threadId'].includes(k)) || typeof v.kind !== 'string' || !['planning', 'execution'].includes(v.kind)) throw new ProjectPolicyError('bad_request', 'Only runtime kind and assistant/thread selection are accepted');
  for (const key of ['assistantId', 'threadId']) if (v[key] !== undefined && (typeof v[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v[key]))) throw new ProjectPolicyError('bad_request', 'Invalid runtime selection identifier');
  return v as unknown as ContextSelection;
}
export class RuntimeContextService {
  public constructor(private readonly options: { config: RuntimeConfig; deploymentId?: string; workspaceRoot: string; projects: Pick<ProjectsService, 'getProject' | 'getPlanning'>; ownership: Pick<RuntimeOwnershipService, 'getBinding' | 'prepareBinding'>; runtime: RuntimeReadPort; router?: Pick<RuntimeRouter, 'reads' | 'endpoint'> }) {}
  /** The read port for one engagement: its own environment's runtime under ADR-0092, else the fixed legacy runtime. */
  private async reads(engagementId: string | undefined): Promise<RuntimeReadPort> {
    return engagementId !== undefined && this.options.router ? this.options.router.reads(engagementId) : this.options.runtime;
  }
  public async agents(engagementId?: string): Promise<{ source: 'runtime'; graphs: readonly string[] }> {
    const graphs = await (await this.reads(engagementId)).catalog();
    return { source: 'runtime', graphs: graphs.filter(g => this.options.config.assistants.includes(g)) };
  }
  public async resolve(userId: string, engagementId: string, raw: unknown): Promise<TrustedRuntimeContext> {
    const selection = parseContextSelection(raw);
    const { projects, ownership, config } = this.options;
    const project = await projects.getProject(userId, engagementId);
    const endpoint = await this.options.router?.endpoint(engagementId);
    const runtime = await this.reads(engagementId);
    assertProjectTarget(project.targetType, project.targetValue);
    const dir = await resolveEngagementWorkspaceDir(this.options.workspaceRoot, project.workspaceSlug);
    let realRoot: string;
    try { realRoot = await realpath(this.options.workspaceRoot); } catch { throw new RuntimeUnavailableError(); }
    try {
      if ((await lstat(dir)).isSymbolicLink() || await realpath(dir) !== path.join(realRoot, project.workspaceSlug)) throw mismatch();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (endpoint?.environmentId == null && config.pinnedSlug !== undefined && config.pinnedSlug !== project.workspaceSlug) throw mismatch();
    const bound = selection.threadId ? await ownership.getBinding(userId, engagementId, selection.threadId) : undefined;
    if (bound && (bound.kind !== selection.kind || selection.assistantId !== undefined && bound.assistantId !== selection.assistantId)) throw mismatch();
    const { graphs } = await this.agents(engagementId);
    const assistantId = bound?.assistantId ?? selection.assistantId ?? (selection.kind === 'planning' ? PLANNING_ASSISTANT : EXECUTION_ASSISTANTS.find(g => graphs.includes(g)));
    if (!assistantId || !graphs.includes(assistantId)) throw new RuntimeUnavailableError();
    if (selection.kind === 'planning' && assistantId !== 'soundwave' || selection.kind === 'execution' && assistantId === 'soundwave') throw mismatch();
    const sandboxUrl = endpoint?.environmentId != null ? environmentSandboxUrlFor(this.options.deploymentId ?? 'default', endpoint.environmentId) : config.perProjectSandbox ? sandboxUrlFor(project.workspaceSlug) : config.sandboxUrl;
    const stableConfigurable = { engagement_name: project.workspaceSlug, workspace_path: path.posix.join(config.workspaceRoot, project.workspaceSlug), target_type: project.targetType, target_value: project.targetValue, authorization_confirmed: project.authorizationConfirmed, ...(config.language ? { language: config.language } : {}), ...(sandboxUrl ? { sandbox_url: sandboxUrl } : {}) };
    // The HITL switch is not part of the runtime identity: toggling it must not invalidate a bound thread.
    const runtimeConfigHash = requestFingerprint({ engagementId, assistantId, kind: selection.kind, configurable: stableConfigurable });
    const configurable = bound?.hitlEnabled === false ? { ...stableConfigurable, hitl_enabled: false as const } : stableConfigurable;
    const metadata = { engagement_id: engagementId, workspace_slug: project.workspaceSlug, ui_assistant_id: assistantId, graph_id: assistantId, ui_flow: selection.kind, runtime_context_hash: runtimeConfigHash };
    if (bound) {
      await ownership.getBinding(userId, engagementId, bound.threadId, { assistantId, kind: selection.kind, runtimeConfigHash });
      const remote = await runtime.thread(bound.threadId);
      if (Object.entries(metadata).some(([k, v]) => remote.metadata[k] !== v) || remote.metadata.assistantId !== undefined && remote.metadata.assistantId !== assistantId) throw mismatch();
      const { values, graphId } = await runtime.state(bound.threadId);
      const fields = Object.entries(configurable).filter(([k]) => k !== 'sandbox_url' && k !== 'hitl_enabled');
      if (Object.keys(values).length && (graphId !== assistantId || fields.some(([k, v]) => values[k] !== v))) throw mismatch();
      if (values.kg_engagement !== undefined && values.kg_engagement !== '' && values.kg_engagement !== project.workspaceSlug || values.language !== undefined && values.language !== '' && values.language !== config.language || values.sandbox_url !== undefined && values.sandbox_url !== '' && values.sandbox_url !== sandboxUrl) throw mismatch();
    }
    const planning = await projects.getPlanning(userId, engagementId);
    const bindingHash = await ownership.prepareBinding(userId, engagementId, assistantId, selection.kind);
    const expectedBinding = requestFingerprint({ engagementId, workspaceSlug: project.workspaceSlug, targetType: project.targetType, targetValue: project.targetValue, authorizationConfirmed: project.authorizationConfirmed, assistantId, kind: selection.kind });
    if (bindingHash !== expectedBinding) throw mismatch();
    return { engagementId, workspaceSlug: project.workspaceSlug, assistantId, kind: selection.kind, configurable, runtimeConfigHash, bindingHash, metadata, publicView: { engagementId, workspaceSlug: project.workspaceSlug, assistantId, kind: selection.kind, authorizationConfirmed: project.authorizationConfirmed, planningState: planning.readiness.state, executionReady: project.metadataState === 'verified' && planning.readiness.state === 'ready', threadVerified: bound !== undefined, source: 'runtime' } };
  }
}
