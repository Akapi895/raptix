import { z } from 'zod';
import { aiRoleSchema, assetSchema, assignmentSchema, configSchema, conversationSchema, factEdgeSchema, factSchema, graphSchema, hitlConfigSchema, json, knowledgeSchema, listenerSchema, mcpSchema, profileSchema, projectSchema, roleSchema, skillSchema, taskSchema, toolGuardSchema, userSchema, vulnerabilitySchema, webshellSchema } from './types';

const text = z.string().optional();
const strings = z.array(z.string()).optional();
const ids = z.object({ ids: strings });
const agent = z.object({ message: text, conversationId: z.string().nullish().transform(value => value ?? undefined), projectId: text, role: text });
export const bodies = {
  login: z.object({ username: text, password: text }),
  password: z.object({ current_password: text, new_password: text }),
  role: roleSchema.partial(), user: userSchema.partial(), assignment: assignmentSchema.partial(),
  conversation: conversationSchema.partial().extend({ role: text }), deleteTurn: z.object({ messageId: text }), agent,
  ids, project: projectSchema.partial(), fact: factSchema.partial(), factKeys: z.object({ fact_keys: strings, ids: strings }), edge: factEdgeSchema.partial(),
  vulnerability: vulnerabilitySchema.partial(), alert: z.object({ enabled: z.boolean().optional(), minSeverity: text }),
  asset: assetSchema.partial(), assetImport: z.object({ assets: z.array(assetSchema.partial()).optional() }), assetBulk: ids.extend({ patch: assetSchema.partial().optional() }),
  queue: z.object({ workflowId: text, title: text, message: text, role: text, hitlPolicy: text, scheduleMode: text, cronExpr: text, enabled: z.boolean().optional(), scheduleEnabled: z.boolean().optional(), projectId: text, concurrency: z.number().optional(), tasks: strings, executeNow: z.boolean().optional() }),
  task: taskSchema.partial(), hitl: hitlConfigSchema.partial().extend({ conversationId: text, sensitiveTools: strings }), reviewer: z.object({ reviewer: text }),
  auditStrategy: z.object({ strategy: text, auditAgentEnabled: z.boolean().optional(), auditAgentPrompt: text, auditAgentPromptReviewEdit: text }),
  tools: z.object({ tools: strings, tool: text, toolWhitelist: strings, sensitiveTools: strings }),
  hitlLogs: ids.extend({ all: z.boolean().optional() }),
  decision: z.object({ interruptId: text, id: text, decision: text, action: text, comment: text, editedArguments: z.record(z.string(), z.unknown()).nullable().optional() }),
  config: configSchema.partial(), toolGuard: toolGuardSchema.partial(), command: z.object({ command: text }), skill: skillSchema.partial(), aiRole: aiRoleSchema.partial(),
  filename: z.object({ filename: text }), knowledge: knowledgeSchema.partial(), mcp: mcpSchema.partial(),
  workflow: z.object({ name: text, description: text, enabled: z.boolean().optional(), graph_json: graphSchema.optional(), graph: graphSchema.optional() }), prompt: z.object({ prompt: text }),
  listener: listenerSchema.partial().extend({ bind_host: text, bind_port: z.number().optional(), profile_id: text, callback_host: text, config: z.record(z.string(), z.unknown()).optional() }),
  note: z.object({ note: text }), sleep: z.object({ sleep: z.number().optional(), sleep_seconds: z.number().optional(), jitter_percent: z.number().optional() }),
  c2Task: z.object({ sessionId: text, session: text, command: text, session_id: text, task_type: text, payload: z.record(z.string(), json).optional() }), profile: profileSchema.partial(),
  webshell: webshellSchema.partial().extend({ password: text }), path: z.object({ path: text, newPath: text }), query: z.object({ query: text }),
  upload: z.instanceof(FormData),
  filesMkdir: z.object({ parent: z.string(), name: z.string() }),
  filesRename: z.object({ path: z.string(), newName: z.string() }),
  filesDelete: z.object({ path: z.string() }),
};
export type AgentBody = z.infer<typeof agent>;
