import { describe, expect, it, vi } from 'vitest';
import { createWorkflowsService } from './service';
import { composeDraft } from './compose';
import { parseGraph, validateGraph, type Graph } from './model';
import { allowedActions, buildImportRequest, createInspection, decodeImport, decodeInspection, WorkflowPackageError } from './package-client';

const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers });
const graph: Graph = { nodes: [{ id: 's', type: 'start', label: 'Start', config: {} }, { id: 'o', type: 'output', label: 'Output', config: { output_key: 'result' } }], edges: [{ id: 'e', source: 's', target: 'o', label: '', config: {} }], config: { custom: { preserve: true } } };
const meta = { id: 'wf/id', name: 'Recon', description: 'Graph', enabled: true };

describe('workflow service', () => {
  it('reads Go JSON strings and demo object graphs and saves the correct envelope', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method ? json({ workflow: { ...meta, graph_json: JSON.stringify(graph) } }) : json({ workflows: [{ ...meta, graph_json: JSON.stringify(graph) }, { ...meta, id: 'demo', graph_json: graph }] }));
    const service = createWorkflowsService(request); await service.list(); expect(service.workflows.map(wf => parseGraph(wf.graph_json))).toEqual([graph, graph]);
    expect((await service.save(meta, graph, meta.id)).id).toBe(meta.id);
    expect(request).toHaveBeenLastCalledWith('/api/workflows/wf%2Fid', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...meta, graph }) }));
  });
  it('loads all tool pages, deduplicates qualified MCP keys and caches options', async () => {
    const request = vi.fn(async (path: string) => json({ total_pages: 2, tools: path.includes('page=1') ? [{ name: 'scan', enabled: false }, { name: 'scan', is_external: true, external_mcp: 'mcp' }] : [{ name: 'scan' }, { name: 'report' }] }));
    const service = createWorkflowsService(request); expect(await service.tools()).toEqual([{ name: 'scan', key: 'scan', enabled: false }, { name: 'scan', key: 'mcp::scan', enabled: true }, { name: 'report', key: 'report', enabled: true }]); await service.tools(); expect(request).toHaveBeenCalledTimes(2);
  });
  it('normalizes Go dry-run traces and the abbreviated demo trace', async () => {
    const request = vi.fn(async () => json({ result: { trace: [{ nodeId: 's', status: 'completed' }] } })); const service = createWorkflowsService(request);
    expect((await service.dryRun(graph, 'ping')).trace).toEqual([{ nodeId: 's', status: 'completed' }]);
    request.mockImplementation(async () => json({ status: 'ok', steps: [{ node: 'start', result: 'would run (demo)' }] })); expect((await service.dryRun(graph, 'hello')).trace[0]).toMatchObject({ nodeId: 'start', status: 'would run (demo)' });
  });
  it('preserves Go AI graph/audit/options and only expands the known demo shorthand', async () => {
    const draft = composeDraft('port scan report', { includeObjective: true, allowSchedule: false, allowHighRisk: false }, [{ name: 'nmap', key: 'nmap', enabled: true }], key => key);
    const request = vi.fn(async () => json({ result: { ...draft, generator: 'llm' } })); const service = createWorkflowsService(request); const options = { includeObjective: true, allowSchedule: true, allowHighRisk: false };
    expect((await service.generate('scan', options, [])).generator).toBe('llm'); expect(request).toHaveBeenLastCalledWith('/api/workflows/generate-draft', expect.objectContaining({ body: JSON.stringify({ prompt: 'scan', options: { include_objective: true, allow_schedule: true, allow_high_risk: false }, available_tools: [] }) }));
    request.mockImplementation(async () => json({ name: 'Draft from prompt', description: '', nodes: [{ id: 'n1', type: 'tool', tool: 'nmap_scan' }] })); const demo = await service.generate('port scan report', options, [{ name: 'nmap', key: 'nmap', enabled: true }]); expect(validateGraph(demo.graph, key => key)).toEqual([]);
    request.mockImplementation(async () => json({ graph: { nodes: false } })); await expect(service.generate('scan', options, [])).rejects.toThrow('workflows.ai.generateFailed');
  });
  it('keeps structured package errors and retries identical imports using the same idempotency key', async () => {
    const uuid = vi.fn().mockReturnValueOnce('key-one').mockReturnValueOnce('key-two');
    const request = vi.fn().mockResolvedValueOnce(json({ error: { code: 'WFPKG_IMPORT_FAILED', message: 'Retry me', details: { retryable: true } } }, 503)).mockImplementation(async () => json({ import: { id: 'import-id', result: 'created' } }));
    const service = createWorkflowsService(request, uuid); const payload = buildImportRequest({ inspectionId: 'inspect', action: 'create' });
    await expect(service.importPackage(payload)).rejects.toMatchObject({ code: 'WFPKG_IMPORT_FAILED', message: 'Retry me', details: { retryable: true } });
    await service.importPackage(payload); expect(uuid).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith('/api/workflow-package-imports', expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'key-one' } }));
    await service.importPackage(buildImportRequest({ inspectionId: 'other', action: 'rename', newWorkflowId: 'copy' })); expect(uuid).toHaveBeenCalledTimes(2);
  });
  it('downloads named binary packages and surfaces plain Go HTTP failures', async () => {
    const request = vi.fn(async () => new Response('zip', { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''recon%20copy.csapkg.zip" } }));
    const service = createWorkflowsService(request); const result = await service.exportPackage('wf/id'); expect(result.filename).toBe('recon copy.csapkg.zip'); expect(await result.blob.text()).toBe('zip');
    request.mockImplementation(async () => json({ error: 'referenced by a role' }, 409)); await expect(service.remove('wf/id')).rejects.toThrow('referenced by a role');
  });
  it('retains pending/get/replay/resume contracts for the existing HITL hubs', async () => {
    const request = vi.fn(async (path: string) => path.endsWith('run%2F1') ? json({ run: { id: 'run/1', workflow_id: 'wf', workflow_version: 1, status: 'awaiting_hitl', started_at: '2026-10-31T00:00:00Z' }, nodeRuns: [] }) : json({ status: 'delegated', streamResuming: true, workflowRunId: 'run/1' })); const service = createWorkflowsService(request);
    await service.pendingRuns('conversation/1'); expect(request).toHaveBeenLastCalledWith('/api/workflows/runs/pending?conversationId=conversation%2F1', undefined);
    await service.getRun('run/1'); await service.replayRun('run/1'); expect(await service.resumeRun('run/1', false, 'needs edits')).toMatchObject({ streamResuming: true });
    expect(request).toHaveBeenLastCalledWith('/api/workflows/runs/run%2F1/resume', expect.objectContaining({ body: '{"approved":false,"comment":"needs edits"}' }));
  });
});

describe('workflow package validation', () => {
  it('allows only the defined conflict resolutions and requires explicit overwrite consent', () => {
    expect(allowedActions('none')).toEqual(['create']); expect(allowedActions('identical')).toEqual(['keep_existing']); expect(allowedActions('unknown')).toEqual([]);
    expect(() => buildImportRequest()).toThrow(WorkflowPackageError);
    expect(() => buildImportRequest(null)).toThrow(WorkflowPackageError); expect(new WorkflowPackageError().message).toBe('WFPKG_REQUEST_FAILED');
    expect(() => buildImportRequest({ inspectionId: 'i', action: 'rename' })).toThrow('Enter a new workflow ID');
    expect(() => buildImportRequest({ inspectionId: 'i', action: 'create', newWorkflowId: 'wrong' })).toThrow('The current action does not allow a new workflow ID');
    expect(() => buildImportRequest({ inspectionId: 'i', action: 'overwrite' })).toThrow('Confirm overwriting the local workflow');
    expect(buildImportRequest({ inspectionId: ' i ', action: 'overwrite', confirmOverwrite: true })).toEqual({ inspection_id: 'i', resolution: { action: 'overwrite', new_workflow_id: '' }, confirm_overwrite: true });
  });
  it('validates upload size/extension and sends multipart without overriding its boundary', async () => {
    const request = vi.fn(async () => json({ inspection: { id: 'i' } }));
    await expect(createInspection(request, null)).rejects.toMatchObject({ code: 'WFPKG_FILE_REQUIRED' });
    await expect(createInspection(request, new File(['x'], 'bad.zip'))).rejects.toMatchObject({ code: 'WFPKG_UNSUPPORTED_FORMAT' });
    await expect(createInspection(request, new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csapkg.zip'))).rejects.toMatchObject({ code: 'WFPKG_FILE_TOO_LARGE' }); expect(request).not.toHaveBeenCalled();
    await createInspection(request, new File(['zip'], 'local.CSAPKG.ZIP')); expect(request).toHaveBeenLastCalledWith('/api/workflow-package-inspections', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
  });
  it('normalizes abbreviated demo IDs and full Go inspection/import envelopes', () => {
    expect(decodeInspection({ inspectionId: 'demo', status: 'ok' })).toMatchObject({ id: 'demo', conflict: { state: 'none' } });
    expect(decodeInspection({ inspection: { id: 'go', conflict: { state: 'identical' } } })).toMatchObject({ id: 'go', conflict: { state: 'identical' } });
    expect(decodeImport({ importId: 'demo', status: 'imported' }).id).toBe('demo'); expect(decodeImport({ import: { id: 'go', result: 'renamed' } }).result).toBe('renamed');
  });
});

describe('graph validation and deterministic composer', () => {
  it('retains Go graphs with nil config maps or nil edge slices instead of discarding their nodes', () => {
    const value = parseGraph(JSON.stringify({ nodes: [{ id: 's', type: 'start', label: 'Start', config: null }], edges: null, config: null }));
    expect(value.nodes).toEqual([{ id: 's', type: 'start', label: 'Start', config: {} }]); expect(value.edges).toEqual([]); expect(value.config).toEqual({});
  });
  it('rejects dangling edges, cycles, missing tools and unreachable nodes', () => {
    const invalid = parseGraph({ nodes: [...graph.nodes, { id: 'tool', type: 'tool', config: {} }], edges: [...graph.edges, { id: 'dangling', source: 'missing', target: 's' }, { id: 'loop', source: 's', target: 's' }] });
    const errors = validateGraph(invalid, key => key); expect(errors).toEqual(expect.arrayContaining(['workflows.validation.edgeSourceMissing', 'workflows.validation.edgeSelfLoop', 'workflows.validation.graphCycle', 'workflows.validation.toolNeedsMcp', 'workflows.validation.nodeUnreachable']));
  });
  it('builds valid high-risk conditional drafts with HITL, qualified tools, schedule hints and review metadata', () => {
    const result = composeDraft('daily nmap port scan if high risk block host and report with human approval', { allowSchedule: true, allowHighRisk: false, includeObjective: true }, [{ name: 'nmap', key: 'mcp::nmap', enabled: true }], key => key);
    expect(validateGraph(result.graph, key => key)).toEqual([]); expect(result.graph.nodes.some(node => node.type === 'hitl')).toBe(true); expect(result.graph.nodes.some(node => node.config.tool_name === 'mcp::nmap')).toBe(true); expect(result.graph.config.trigger_suggestion).toBe('daily'); expect(result.audit.risk_warnings.length).toBeGreaterThan(0);
  });
});
