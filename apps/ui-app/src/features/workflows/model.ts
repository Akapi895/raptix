import { z } from 'zod';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;
export const nodeTypes = ['start', 'tool', 'agent', 'condition', 'hitl', 'output', 'end'] as const;
export type NodeType = typeof nodeTypes[number];
export interface Binding { from: string; field: string }
// The Go graph config is intentionally extensible, including nested binding objects.
export type Config = Record<string, unknown>;
export const configSchema = z.record(z.string(), z.unknown());
const graphConfigSchema = configSchema.nullish().transform(config => config ?? {});
export const nodeSchema = z.object({
  id: z.string(), type: z.string().default('tool'), label: z.string().default(''),
  position: z.object({ x: z.number(), y: z.number() }).nullable().transform(position => position ?? undefined).optional(), config: graphConfigSchema,
});
export const edgeSchema = z.object({
  id: z.string().default(''), source: z.string(), target: z.string(),
  label: z.string().default(''), config: graphConfigSchema,
});
export const graphSchema = z.object({ nodes: z.array(nodeSchema).nullish().transform(nodes => nodes ?? []), edges: z.array(edgeSchema).nullish().transform(edges => edges ?? []), config: graphConfigSchema });
export type Graph = z.infer<typeof graphSchema>;
export type GraphNode = Graph['nodes'][number];
export type GraphEdge = Graph['edges'][number];
// database.WorkflowDefinition; demo returns an object for graph_json instead of a JSON string.
export const workflowSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().default(''), version: z.number().default(1),
  enabled: z.boolean().default(true), graph_json: z.union([z.string(), graphSchema]).optional(),
  graph: graphSchema.optional(), validation_error: z.string().default(''),
  created_at: z.string().optional(), updated_at: z.string().optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export interface WorkflowMeta { id: string; name: string; description: string; enabled: boolean }
export interface ToolOption { key: string; name: string; enabled: boolean }
export interface AiOptions { includeObjective: boolean; allowSchedule: boolean; allowHighRisk: boolean }
export const aiResultSchema = z.object({
  graph: graphSchema, meta: z.object({ id: z.string().default(''), name: z.string().default(''), description: z.string().default('') }),
  generator: z.string().default('server'),
  audit: z.object({ risk_warnings: z.array(z.string()).default([]), assumptions: z.array(z.string()).default([]), missing_fields: z.array(z.string()).default([]), high_risk: z.boolean().optional(), needs_hitl: z.boolean().optional(), savable: z.boolean().optional() }).default({ risk_warnings: [], assumptions: [], missing_fields: [] }),
  riskWarnings: z.array(z.string()).default([]), assumptions: z.array(z.string()).default([]),
  capabilities: z.array(z.object({ label: z.string(), tool_name: z.string().optional(), toolName: z.string().optional(), tool_candidates: z.array(z.string()).optional() })).default([]),
  stats: z.object({ nodes: z.number().optional(), edges: z.number().optional() }).default({}),
});
export type AiResult = z.infer<typeof aiResultSchema>;
export const traceSchema = z.object({ nodeId: z.string().optional(), label: z.string().optional(), type: z.string().optional(), status: z.string().optional() }).passthrough();
export interface DryRunResult { trace: z.infer<typeof traceSchema>[]; [key: string]: unknown }
export const runSchema = z.object({
  id: z.string(), workflow_id: z.string(), workflow_version: z.number(), status: z.string(),
  conversation_id: z.string().default(''), project_id: z.string().default(''), role_id: z.string().default(''),
  input_json: z.string().default(''), output_json: z.string().default(''), error: z.string().default(''),
  graph_json: z.string().default(''), pending_hitl_node_id: z.string().default(''), pending_hitl_json: z.string().default(''),
  started_at: z.string(), finished_at: z.string().nullish(),
});
export const nodeRunSchema = z.object({
  id: z.string(), node_id: z.string(), status: z.string(), input_json: z.string().default(''), output_json: z.string().default(''),
  error: z.string().default(''), started_at: z.string(), finished_at: z.string().nullish(),
});
export type WorkflowRun = z.infer<typeof runSchema>;
export type NodeRun = z.infer<typeof nodeRunSchema>;
export const emptyGraph = (): Graph => ({ nodes: [], edges: [], config: {} });
export function parseGraph(raw: unknown): Graph {
  try { return graphSchema.parse(typeof raw === 'string' ? JSON.parse(raw) as unknown : raw); }
  catch { return emptyGraph(); }
}
export function text(value: unknown): string { return value == null ? '' : String(value); }
export function binding(value: unknown, from = 'previous', field = 'output'): Binding {
  const parsed = z.object({ from: z.string().optional(), field: z.string().optional() }).safeParse(value);
  return { from: parsed.success ? parsed.data.from || from : from, field: parsed.success ? parsed.data.field || field : field };
}
export function defaultConfig(type: string, t: Translate): Config {
  switch (type) {
    case 'start': return { input_keys: 'message, conversationId, projectId' };
    case 'tool': return { tool_name: '', arguments: '{}', timeout_seconds: '', join_strategy: 'all_merge' };
    case 'agent': return { input_binding: binding(null), instruction: '', output_key: 'agent_result', join_strategy: 'all_merge' };
    case 'condition': return { expression: '{{previous.output}} != ""', join_strategy: 'all_merge' };
    case 'hitl': return { prompt: t('workflows.defaultHitlPrompt'), prompt_binding: binding(null), reviewer: 'human', join_strategy: 'all_merge' };
    case 'output': return { output_key: 'result', source_binding: binding(null), join_strategy: 'all_merge' };
    case 'end': return { result_binding: binding(null, 'outputs', 'result'), join_strategy: 'all_merge' };
    default: return {};
  }
}

export interface GraphIssue { message: string; elementId?: string; addType?: NodeType; fieldId?: string }
export function validateGraphIssues(graph: Graph, t: Translate): GraphIssue[] {
  const errors: GraphIssue[] = [];
  const { nodes, edges } = graph;
  const ids = new Set(nodes.map(n => n.id));
  const starts = nodes.filter(n => n.type === 'start');
  const outputs = nodes.filter(n => n.type === 'output');
  const error = (key: string, node: GraphNode) => errors.push({ message: t('workflows.validation.' + key, { label: node.label || node.id }), elementId: node.id });
  if (!starts.length) errors.push({ message: t('workflows.validation.needStart'), addType: 'start' });
  if (!outputs.length) errors.push({ message: t('workflows.validation.needOutput'), addType: 'output' });
  for (const edge of edges) {
    for (const [bad, key] of [[edge.source === edge.target, 'edgeSelfLoop'], [!ids.has(edge.source), 'edgeSourceMissing'], [!ids.has(edge.target), 'edgeTargetMissing']] as const) {
      if (bad) errors.push({ message: t('workflows.validation.' + key, { id: edge.id }), elementId: edge.id });
    }
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...outgoing.get(edge.source) ?? [], edge.target]);
  for (const node of nodes) {
    const incoming = edges.some(e => e.target === node.id);
    const out = edges.filter(e => e.source === node.id);
    if (node.type === 'start' && incoming) error('startIncoming', node);
    if (['output', 'end'].includes(node.type) && out.length) error('outputOutgoing', node);
    if (node.type !== 'start' && !incoming) error('nodeNeedsIncoming', node);
    if (!['output', 'end'].includes(node.type) && !out.length) error('nodeNeedsOutgoing', node);
    if (node.type === 'tool' && !text(node.config.tool_name).trim()) error('toolNeedsMcp', node);
    if (node.type === 'tool' && typeof node.config.arguments === 'string' && node.config.arguments.trim()) {
      try { JSON.parse(node.config.arguments); }
      catch { errors.push({ message: `${node.label || node.id}: tool arguments must be valid JSON. Fix the highlighted JSON field.`, elementId: node.id, fieldId: 'workflow-tool-arguments' }); }
    }
    if (node.type === 'output' && !text(node.config.output_key).trim()) error('outputNeedsKey', node);
    if (node.type === 'condition') {
      if (!text(node.config.expression).trim()) error('conditionNeedsExpr', node);
      if (!out.length) error('conditionNeedsOutEdge', node);
      if (out.length > 2) error('conditionTooManyEdges', node);
      const branches = out.map(e => text(e.config.branch || e.label).trim().toLowerCase());
      if (branches.some(b => !['true', 'false', '\u662f', '\u5426', 'yes', 'no', 'y', 'n'].includes(b))) error('conditionBranchLabel', node);
      if (new Set(branches).size !== branches.length) error('conditionBranchDuplicate', node);
    }
  }
  const reached = new Set<string>();
  const queue = starts.map(n => n.id);
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined || reached.has(id)) continue;
    reached.add(id); queue.push(...outgoing.get(id) ?? []);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of outgoing.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (nodes.some(n => ['output', 'end'].includes(n.type))) for (const node of nodes) {
    if (!reached.has(node.id)) error('nodeUnreachable', node);
    if (visit(node.id)) error('graphCycle', node);
  }
  return errors.filter((issue, index) => errors.findIndex(other => other.message === issue.message && other.elementId === issue.elementId) === index);
}
export function validateGraph(graph: Graph, t: Translate): string[] {
  return [...new Set(validateGraphIssues(graph, t).map(issue => issue.message))];
}
