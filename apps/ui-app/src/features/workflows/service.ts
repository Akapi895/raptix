import { z } from 'zod';
import { aiResultSchema, graphSchema, traceSchema, workflowSchema, type AiOptions, type AiResult, type DryRunResult, type Graph, type RequestFn, type ToolOption, type Translate, type Workflow, type WorkflowMeta } from './model';
import * as packages from './package-client';
import { composeDraft } from './compose';
import { nodeRunSchema, runSchema } from './model';

export function createWorkflowsService(request: RequestFn, uuid = packages.createIdempotencyKey, t: Translate = key => key) {
  let workflows: Workflow[] = [], tools: ToolOption[] | undefined;
  let signature = '', idempotencyKey = '';
  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init);
    if (!response.ok) {
      const error = await packages.readApiError(response);
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.status === 204 ? {} : response.json() as Promise<unknown>;
  }
  const body = (method: string, value: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return {
    get workflows(): readonly Workflow[] { return workflows; },
    async list(includeDisabled = true): Promise<Workflow[]> {
      const data = z.object({ workflows: z.array(workflowSchema).nullish() }).parse(await json('/api/workflows?includeDisabled=' + includeDisabled));
      workflows = data.workflows ?? []; return workflows;
    },
    async tools(): Promise<ToolOption[]> {
      if (tools) return tools;
      const found: ToolOption[] = [], seen = new Set<string>();
      let totalPages = 1;
      for (let page = 1; page <= totalPages && page <= 20; page++) {
        const response = await request(`/api/config/tools?page=${page}&page_size=100`);
        if (!response.ok) break;
        const data = z.object({ total_pages: z.number().optional(), tools: z.array(z.object({ name: z.string(), enabled: z.boolean().optional(), is_external: z.boolean().optional(), external_mcp: z.string().optional() })).nullish() }).parse(await response.json());
        totalPages = data.total_pages || 1;
        for (const tool of data.tools ?? []) {
          const key = tool.is_external && tool.external_mcp ? `${tool.external_mcp}::${tool.name}` : tool.name;
          if (!key || seen.has(key)) continue;
          seen.add(key); found.push({ key, name: tool.name, enabled: tool.enabled !== false });
        }
      }
      tools = found; return found;
    },
    async validate(graph: Graph): Promise<void> { await json('/api/workflows/validate', body('POST', { graph })); },
    async save(meta: WorkflowMeta, graph: Graph, currentId = ''): Promise<Workflow> {
      const data = await json(currentId ? '/api/workflows/' + encodeURIComponent(currentId) : '/api/workflows', body(currentId ? 'PUT' : 'POST', { ...meta, graph }));
      const envelope = z.object({ workflow: z.unknown().optional() }).passthrough().parse(data);
      return workflowSchema.parse(envelope.workflow ?? envelope);
    },
    async remove(id: string): Promise<void> { await json('/api/workflows/' + encodeURIComponent(id), { method: 'DELETE' }); },
    async dryRun(graph: Graph, message: string): Promise<DryRunResult> {
      const raw = z.object({ result: z.unknown().optional() }).passthrough().parse(await json('/api/workflows/dry-run', body('POST', { graph, inputs: { message } })));
      const result = z.object({ trace: z.array(traceSchema).default([]), steps: z.array(z.object({ node: z.string().optional(), result: z.string().optional() })).optional() }).passthrough().parse(raw.result ?? raw);
      return { ...result, trace: result.trace.length ? result.trace : (result.steps ?? []).map(s => ({ nodeId: s.node, status: s.result })) };
    },
    async generate(prompt: string, options: AiOptions, availableTools: ToolOption[]): Promise<AiResult> {
      const raw = z.object({ result: z.unknown().optional() }).passthrough().parse(await json('/api/workflows/generate-draft', body('POST', { prompt, options: { include_objective: options.includeObjective, allow_schedule: options.allowSchedule, allow_high_risk: options.allowHighRisk }, available_tools: availableTools })));
      const result = aiResultSchema.safeParse(raw.result ?? raw);
      if (!result.success) {
        // The demo supplies only a node hint. Expand that specific abbreviated response;
        // malformed server graphs still fail instead of silently replacing user data.
        const demo = z.object({ name: z.string(), description: z.string(), nodes: z.array(z.object({ id: z.string(), type: z.string(), tool: z.string().optional() })), graph: z.undefined().optional() }).safeParse(raw);
        if (demo.success) return composeDraft(prompt, options, availableTools, t);
        throw new Error('workflows.ai.generateFailed');
      }
      return result.data;
    },
    async exportPackage(id: string): Promise<{ blob: Blob; filename: string }> {
      const response = await request('/api/workflows/' + encodeURIComponent(id) + '/package', { method: 'GET' });
      if (!response.ok) { const e = await packages.readApiError(response); throw new packages.WorkflowPackageError(e.code, e.message, e.details); }
      const match = (response.headers.get('Content-Disposition') ?? '').match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i);
      let filename = `${id}.csapkg.zip`;
      if (match?.[1]) { try { filename = decodeURIComponent(match[1].trim()); } catch { filename = match[1].trim(); } }
      return { blob: await response.blob(), filename };
    },
    inspect: async (file: File | null) => packages.decodeInspection(await packages.createInspection(request, file)),
    inspection: async (id: string) => packages.decodeInspection(await packages.getInspection(request, id)),
    importRecord: async (id: string) => packages.decodeImport(await packages.getImport(request, id)),
    async importPackage(payload: packages.ImportRequest): Promise<packages.ImportRecord> {
      const nextSignature = JSON.stringify(payload);
      if (!idempotencyKey || signature !== nextSignature) { idempotencyKey = uuid(); signature = nextSignature; }
      return packages.decodeImport(await packages.applyImport(request, payload, idempotencyKey));
    },
    resetImport(): void { signature = ''; idempotencyKey = ''; },
    // Public typed seam for monitor/chat when their legacy run UI is migrated.
    pendingRuns: async (conversationId = '') => json('/api/workflows/runs/pending' + (conversationId ? '?conversationId=' + encodeURIComponent(conversationId) : '')),
    listRuns: async (workflowId = '', status = '', offset = 0) => z.object({ runs: z.array(runSchema).nullish().transform(r => r ?? []), hasMore: z.boolean().default(false) }).parse(await json('/api/workflows/runs?' + new URLSearchParams({ workflowId, status, offset: String(offset), limit: '50' }))),
    getRun: async (id: string) => z.object({ run: runSchema, nodeRuns: z.array(nodeRunSchema).nullish().transform(r => r ?? []) }).parse(await json('/api/workflows/runs/' + encodeURIComponent(id))),
    replayRun: async (id: string) => json('/api/workflows/runs/' + encodeURIComponent(id) + '/replay'),
    resumeRun: async (id: string, approved: boolean, comment = '') => json('/api/workflows/runs/' + encodeURIComponent(id) + '/resume', body('POST', { approved, comment })),
    async activity(conversationId: string): Promise<unknown[]> {
      const conversation = z.object({ messages: z.array(z.object({ id: z.string(), role: z.string() })).nullish() }).parse(await json('/api/conversations/' + encodeURIComponent(conversationId) + '?include_process_details=0'));
      const events: unknown[] = [];
      for (const message of conversation.messages ?? []) {
        if (message.role !== 'assistant') continue;
        let offset = 0, more = true;
        while (more) {
          const page = z.object({ processDetails: z.array(z.unknown()).nullish(), hasMore: z.boolean().optional() }).parse(await json('/api/messages/' + encodeURIComponent(message.id) + '/process-details?limit=200&offset=' + offset));
          events.push(...page.processDetails ?? []); more = page.hasMore === true; offset += 200;
        }
      }
      return events;
    },
  };
}
export type WorkflowsService = ReturnType<typeof createWorkflowsService>;
export { graphSchema };
