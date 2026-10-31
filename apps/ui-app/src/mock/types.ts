import { z } from 'zod';
import { conversationSchema as apiConversationSchema, messageSchema as apiMessageSchema } from '../api/types/conversation';
import { projectSchema as apiProjectSchema } from '../api/types/project';
import { vulnerabilitySchema as apiVulnerabilitySchema } from '../api/types/vulnerability';
import { assetSchema as apiAssetSchema } from '../api/types/asset';
import { runSchema, nodeRunSchema } from '../features/workflows/model';

// Local fixture DTOs retain the Go endpoints' JSON casing. Schemas also validate
// persisted demo state; storage is an untrusted input, not a typed object store.
export const SEED_VERSION = '2026-10-28-9';
const text = z.string();
const strings = z.array(text);
const stamp = text.nullable();
export const roleSchema = z.object({ id: text, name: text, description: text, scope: text, is_system: z.boolean(), permissions: strings, created_at: text, updated_at: text });
export const userSchema = z.object({ id: text, username: text, display_name: text, enabled: z.boolean(), roles: strings, created_at: text, last_login_at: stamp });
// Compose shared API fields, then describe the existing demo's narrower defaults
// and deliberate differences (sparse asset imports, nullable last_scan_at).
export const projectSchema = z.object(apiProjectSchema.shape).extend({ description: text, scope_json: text });
export const conversationSchema = z.object(apiConversationSchema.shape).omit({ messages: true, retest: true }).extend({ projectId: text, roleName: text, agentMode: text });
export const messageSchema = z.object(apiMessageSchema.shape).extend({ reasoningContent: text, mcpExecutionIds: strings, processDetails: z.array(z.record(text, z.unknown())) });
export const vulnerabilitySchema = z.object(apiVulnerabilitySchema.shape).extend({ project_id: text });
export const assetSchema = z.object(apiAssetSchema.shape).partial().extend({
  id: text, project_id: text, status: text, criticality: text, created_at: text, updated_at: text,
  vulnerability_count: z.number(), risk_level: text, risk_score: z.number(), last_scan_at: stamp.optional(),
});
export const taskSchema = z.object({ id: text, message: text, status: text, conversationId: text, startedAt: stamp, completedAt: stamp, error: text, result: text });
export const queueSchema = z.object({ id: text, workflowId: text.optional(), title: text, role: text, hitlPolicy: text, agentMode: text, scheduleMode: text, cronExpr: text, scheduleEnabled: z.boolean(), nextRunAt: stamp.optional(), projectId: text, concurrency: z.number(), status: text, createdAt: text, startedAt: stamp, completedAt: stamp, currentIndex: z.number(), tasks: z.array(taskSchema), message: text.optional(), updated_at: text.optional() });
export const skillSchema = z.object({ name: text, description: text, category: text, enabled: z.boolean(), version: text, files: strings, tags: strings, updated_at: text });
export const mcpSchema = z.object({ name: text, transport: text, command: text, args: strings, url: text, enabled: z.boolean(), status: text, tools_count: z.number(), last_error: text, description: text.optional() });
export const factSchema = z.object({ id: text, project_id: text, fact_key: text, category: text, summary: text, body: text, confidence: text, pinned: z.boolean(), deprecated: z.boolean(), incoming_links: z.number(), related_vulnerability_id: text, source_conversation_id: text, updated_at: text });
export const factEdgeSchema = z.object({ id: text, project_id: text, source: text, target: text, source_fact_key: text, target_fact_key: text, type: text, edge_type: text, confidence: text });
export const knowledgeSchema = z.object({ id: text, category: text, title: text, content: text, indexed: z.boolean(), updated_at: text });
export const aiRoleSchema = z.object({ name: text, description: text, enabled: z.boolean(), skills: strings, tools: strings, prompt: text, is_builtin: z.boolean(), updated_at: text });
export const hitlConfigSchema = z.object({ enabled: z.boolean(), mode: text, timeoutSeconds: z.number(), toolWhitelist: strings, reviewer: text, auditAgentModel: text, sensitiveTools: strings.optional() });
export const hitlPendingSchema = z.object({ id: text, interruptId: text, conversationId: text, tool: text, toolName: text, arguments: z.object({ endpoint: text, attempts: z.number() }), reason: text, status: text, reviewer: text, created_at: text });
export const hitlLogSchema = z.object({ id: text, interruptId: text, tool: text, decision: text, reviewer: text, decidedAt: text, reason: text.optional(), conversationId: text.optional(), payload: text.optional(), comment: text.optional(), status: text.optional() });
export const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const graphSchema = z.object({ nodes: z.array(z.object({ id: text, label: text.optional(), type: text, config: z.record(text, json).optional(), position: z.object({ x: z.number(), y: z.number() }).optional(), tool: text.optional() })), edges: z.array(z.object({ id: text.optional(), source: text, target: text })) });
export const workflowSchema = z.object({ id: text, name: text, description: text, version: z.number(), enabled: z.boolean(), validation_error: text, graph_json: graphSchema, updated_at: text });
export const listenerSchema = z.object({ id: text, status: text, created_at: text, profile: text, name: text.optional(), type: text.optional(), remark: text.optional(), bindHost: text.optional(), bindPort: z.number().optional(), running: z.boolean().optional(), projectId: text.optional(), bind: text.optional(), port: z.number().optional(), configJson: text.optional(), profileId: text.optional(), project_id: text.optional(), createdAt: text.optional() });
export const webshellSchema = z.object({ id: text, type: text, status: text, created_at: text, password_set: z.boolean(), name: text.optional(), url: text.optional() });
// Settings replaces whole sections, and those edited sections need not contain
// every field in the initial fixture. Preserve additional JSON configuration
// fields as the original mock did (robots/providers evolve independently).
const configSection = <S extends z.ZodRawShape>(shape: S) => z.object(shape).partial().catchall(json);
const channelSchema = configSection({ name: text, provider: text, base_url: text, api_key: text, model: text, max_total_tokens: z.number(), max_completion_tokens: z.number(), reasoning: configSection({ mode: text, effort: text, allow_client_reasoning: z.boolean(), profile: text }) });
export const toolGuardSchema = configSection({ enabled: z.boolean(), mode: text, rules: z.array(json) });
export const configSchema = z.object({
  version: text, server: configSection({ host: text, port: z.number() }), auth: configSection({ session_duration_hours: z.number() }), log: configSection({ level: text }),
  audit: configSection({ enabled: z.boolean(), retention_days: z.number() }), monitor: configSection({ retention_days: z.number() }), storage: configSection({ retention_days: z.number(), auto_cleanup: z.boolean() }),
  ai: configSection({ default_channel: text, channels: z.record(text, channelSchema) }), vision: configSection({ enabled: z.boolean(), base_url: text, api_key: text, model: text }),
  fofa: configSection({ api_key: text, base_url: text }), zoomeye: configSection({ api_key: text, base_url: text }), quake: configSection({ api_key: text, base_url: text }), shodan: configSection({ api_key: text, base_url: text }),
  agent: configSection({ max_iterations: z.number(), timeout_seconds: z.number(), parallel_tools: z.number() }), tool_guard: toolGuardSchema,
  hitl: configSection({ enabled: z.boolean(), timeout_seconds: z.number(), tool_whitelist: strings }),
  multi_agent: configSection({ enabled: z.boolean(), orchestration: text, batch_use_multi_agent: z.boolean(), plan_execute_loop_max_iterations: z.number(), sub_agents: z.array(json), eino_middleware: configSection({ model_retry_max_retries: z.number(), model_retry_max_backoff_sec: z.number(), model_failover_channels: strings, model_failover_max_retries: z.number() }), tool_search_always_visible_tools: strings, tool_search_always_visible_effective_tools: strings }),
  database: configSection({ path: text }), security: configSection({ tools: z.array(json) }), mcp: configSection({ enabled: z.boolean(), port: z.number(), auth_header: text, auth_header_value: text }), external_mcp: configSection({ enabled: z.boolean(), servers: z.record(text, json) }),
  knowledge: configSection({ enabled: z.boolean(), top_k: z.number(), chunk_size: z.number(), embedding_model: text }), c2: configSection({ enabled: z.boolean() }), robots: configSection({ wechat: configSection({ enabled: z.boolean() }), dingtalk: configSection({ enabled: z.boolean() }), lark: configSection({ enabled: z.boolean() }), wecom: configSection({ enabled: z.boolean() }) }), skills_dir: text, agents_dir: text, roles_dir: text, project: configSection({ default_scope: text }),
}).catchall(json);
const c2SessionSchema = z.object({ id: text, implantUuid: text, hostname: text, username: text, os: text, arch: text, pid: z.number(), processName: text, isAdmin: z.boolean(), internalIp: text, externalIp: text, status: text, lastCheckIn: text, sleepSeconds: z.number(), jitterPercent: z.number(), note: text, listenerId: text, listenerName: text, metadata: z.record(text, json) });
const c2TaskSchema = z.object({ id: text, command: text, status: text, output: text, sessionId: text.optional(), createdAt: text.optional(), session: text.optional(), created_at: text.optional(), taskType: text.optional(), payload: z.record(text, json).optional(), resultText: text.optional(), source: text.optional(), completedAt: text.optional() });
export const profileSchema = z.object({ id: text, name: text.optional(), sleepSeconds: z.number().optional(), jitterPercent: z.number().optional(), sleep_seconds: z.number().optional(), jitter: z.number().optional(), userAgent: text.optional(), uris: strings.optional(), requestHeaders: z.record(text, text).optional(), responseHeaders: z.record(text, text).optional(), bodyTemplate: text.optional(), jitterMinMs: z.number().optional(), jitterMaxMs: z.number().optional(), extra: z.record(text, json).optional() });
const uploadSchema = z.object({ name: text, relativePath: text, subPath: text, absolutePath: text, size: z.number(), modifiedUnix: z.number(), date: text, source: text, conversationId: text, conversationTitle: text, projectId: text, projectName: text });
const folderSchema = z.object({ name: text, relativePath: text, subPath: text, conversationId: text, projectId: text });
export const assignmentSchema = z.object({ id: text, user_id: text.optional(), resource_type: text.optional(), resource_id: text.optional(), created_at: text });
export const seedSchema = z.object({
  workflowRuns: z.array(z.object({ run: runSchema, nodeRuns: z.array(nodeRunSchema) })).optional(),
  __version: z.literal(SEED_VERSION), auth: z.object({ username: text, password: text, token: text }), users: z.array(userSchema), roles: z.array(roleSchema), projects: z.array(projectSchema),
  conversations: z.array(conversationSchema), messages: z.array(messageSchema), vulnerabilities: z.array(vulnerabilitySchema), assets: z.array(assetSchema), batchQueues: z.array(queueSchema), skills: z.array(skillSchema), externalMCP: z.array(mcpSchema),
  notifications: z.array(z.object({ id: text, title: text, body: text, read: z.boolean(), created_at: text })), auditLogs: z.array(z.object({ id: text, createdAt: text, level: text, category: text, action: text, result: text, actor: text, clientIp: text, message: text })),
  executions: z.array(z.object({ id: text, toolName: text, status: text, conversationId: text, startedAt: text, durationMs: z.number(), input: text, output: text })), facts: z.array(factSchema), factEdges: z.array(factEdgeSchema), knowledgeCategories: z.array(z.object({ name: text, count: z.number() })), knowledgeItems: z.array(knowledgeSchema), aiRoles: z.array(aiRoleSchema),
  hitlPending: z.array(hitlPendingSchema), hitlLogs: z.array(hitlLogSchema), workflows: z.array(workflowSchema), c2Listeners: z.array(listenerSchema), webshells: z.array(webshellSchema), config: configSchema.nullable(),
  sessionUserId: text.nullable().optional(), robotBindings: z.array(z.object({ id: text })).optional(), assignments: z.array(assignmentSchema).optional(), alertSubscription: z.object({ enabled: z.boolean(), minSeverity: text }).optional(),
  hitlDecisions: z.record(text, text).optional(), hitlConfigs: z.record(text, hitlConfigSchema).optional(), retrievalLogs: z.array(z.object({ id: text, query: text, hits: z.number(), top_item: text, created_at: text })).optional(),
  c2: z.object({ sessions: z.array(c2SessionSchema), tasks: z.array(c2TaskSchema), events: z.array(z.object({ id: text, type: text, message: text, createdAt: text, level: text.optional(), category: text.optional(), sessionId: text.optional(), taskId: text.optional(), data: z.record(text, json).optional() })), profiles: z.array(profileSchema) }).optional(), chatFiles: z.object({ files: z.array(uploadSchema), folders: z.array(folderSchema) }).optional(),
});
export type Seed = z.infer<typeof seedSchema>;
export type Role = z.infer<typeof roleSchema>;
export type User = z.infer<typeof userSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Vulnerability = z.infer<typeof vulnerabilitySchema>;
export type Queue = z.infer<typeof queueSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type ExternalMCP = z.infer<typeof mcpSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type Execution = Seed['executions'][number];
export type Config = z.infer<typeof configSchema>;
