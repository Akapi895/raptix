/** Open-ended Go configuration sections retain fields owned by other settings pages. */
export type ConfigObject = Record<string, unknown>;
export interface Reasoning extends ConfigObject { mode?: string; effort?: string; profile?: string; allow_client_reasoning?: boolean }
export interface AIChannel extends ConfigObject {
  name?: string; provider?: string; api_key?: string; base_url?: string; model?: string;
  max_total_tokens?: number; max_completion_tokens?: number; reasoning?: Reasoning;
}
export interface AIConfig { default_channel: string; channels: Record<string, AIChannel> }
export interface SettingsConfig extends ConfigObject { ai: AIConfig }
export interface Tool {
  name: string; enabled: boolean; description?: string; is_external?: boolean; external_mcp?: string;
}
export interface ToolPage { tools: Tool[]; page: number; page_size: number; total: number; total_enabled: number; total_pages: number }
export interface ToolSchema { properties?: Record<string, { type?: unknown; enum?: unknown[]; description?: string }>; required?: string[] }
export interface MCPConfig extends ConfigObject {
  type?: string; transport?: string; command?: string; url?: string; description?: string; timeout?: number;
}
export interface MCPServer { status?: string; tool_count?: number; error?: string; config: MCPConfig }
export interface MCPData { servers: Record<string, MCPServer>; stats: Record<string, number> }
export interface Probe { status: 'testing' | 'ready' | 'failed'; message: string }
export interface ConnectionResult { success?: boolean; error?: string; model?: string; latency_ms?: number; supported?: boolean; models?: string[]; count?: number }
export interface Credentials extends ConfigObject { provider?: string; api_key?: string; base_url?: string; model?: string; channel_id?: string; credential_scope?: string }
export type ModelScope = 'openai' | 'vision' | 'hitlAudit' | 'knowledgeEmbedding';
export const ROBOTS = ['wechat', 'wecom', 'dingtalk', 'lark', 'telegram', 'slack', 'discord', 'qq'] as const;
export type RobotType = typeof ROBOTS[number];
export interface RobotAuth { mode: 'user_binding' | 'service_account'; service_user_id?: string; allowed_external_users?: string[] }
export function object(value: unknown): ConfigObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as ConfigObject : {}; }
export function text(value: unknown): string { return value == null ? '' : String(value); }
export function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; }
export function splitList(value: string): string[] { return [...new Set(value.split(/[\n,\uff0c]/).map(v => v.trim()).filter(Boolean))]; }
export function getPath(source: unknown, path: string): unknown { return path.split('.').reduce<unknown>((value, key) => object(value)[key], source); }
export function setPath(source: ConfigObject, path: string, value: unknown): void {
  const parts = path.split('.'); const last = parts.pop(); if (!last) return;
  let cursor = source;
  for (const key of parts) { const child = object(cursor[key]); cursor[key] = child; cursor = child; }
  cursor[last] = value;
}
export function normalizeAIChannelId(value: unknown): string { return text(value).trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default'; }
export function channelHostLabel(value: unknown): string {
  const raw = text(value).trim(); if (!raw) return '-';
  try { return new URL(raw).host || raw; } catch { return raw.replace(/^https?:\/\//, '').split('/')[0] || raw; }
}
export function normalizeAIChannelProviderProfile(channel: AIChannel): AIChannel {
  const raw = text(channel.base_url).trim();
  let host = ''; try { host = new URL(raw.includes('://') ? raw : `https://${raw.replace(/^\/+/, '')}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* invalid URLs are displayed for correction */ }
  return host === 'api.deepseek.com' ? { ...channel, reasoning: { ...channel.reasoning, profile: 'deepseek' } } : channel;
}
export function ensureAIConfigShape(config: ConfigObject): AIConfig {
  const raw = object(config.ai); const channels: Record<string, AIChannel> = {};
  for (const [id, value] of Object.entries(object(raw.channels))) channels[id] = normalizeAIChannelProviderProfile(object(value) as AIChannel);
  const id = normalizeAIChannelId(raw.default_channel);
  if (!channels[id]) {
    const old = object(config.openai);
    channels[id] = normalizeAIChannelProviderProfile({ ...old, name: id === 'default' ? 'Default' : id, provider: text(old.provider) || 'openai', api_key: text(old.api_key), base_url: text(old.base_url), model: text(old.model), max_total_tokens: Number(old.max_total_tokens) || 120000, max_completion_tokens: Number(old.max_completion_tokens) || 0, reasoning: object(old.reasoning) });
  }
  return { default_channel: id, channels };
}
export function validateSelectedAIChannelPayload(channel: AIChannel): string {
  return [['base_url', 'Base URL'], ['api_key', 'API Key'], ['model', 'Model']].filter(([key]) => !text(channel[key!]).trim()).map(([, label]) => label).join(', ');
}
export function resolveSavedAIChannelId(ai: AIConfig, preferredId: string, payload: AIChannel = {}): string {
  const id = normalizeAIChannelId(preferredId); if (ai.channels[id]) return id;
  return Object.keys(ai.channels).sort().find(key => ['name', 'model', 'base_url', 'provider'].every(field => text(ai.channels[key]?.[field]).trim() === text(payload[field]).trim())) || ai.default_channel || Object.keys(ai.channels)[0] || id;
}
export function getToolKey(tool: Pick<Tool, 'name' | 'is_external' | 'external_mcp'>): string { return tool.is_external && tool.external_mcp ? `${tool.external_mcp}::${tool.name}` : tool.name; }
export function canonicalToolKey(name: string): string {
  if (name.includes('::')) return name;
  const at = name.lastIndexOf('__'); return at > 0 && at < name.length - 2 ? `${name.slice(0, at)}::${name.slice(at + 2)}` : name;
}
export function decodeToolPage(value: unknown, page = 1, size = 20): ToolPage {
  const raw = object(value);
  const tools = Array.isArray(raw.tools) ? raw.tools.map(object).filter(v => typeof v.name === 'string').map(v => ({ name: text(v.name), enabled: v.enabled === true, description: text(v.description), is_external: v.is_external === true, external_mcp: text(v.external_mcp) })) : [];
  return { tools, page: Number(raw.page) || page, page_size: Number(raw.page_size) || size, total: Number(raw.total) || 0, total_enabled: Number(raw.total_enabled) || 0, total_pages: Number(raw.total_pages) || 1 };
}
export function decodeMCPData(value: unknown): MCPData {
  const raw = object(value); const servers: Record<string, MCPServer> = {};
  for (const [name, value] of Object.entries(object(raw.servers))) servers[name] = decodeMCPServer(value);
  const stats: Record<string, number> = {}; for (const [key, value] of Object.entries(object(raw.stats))) if (typeof value === 'number') stats[key] = value;
  return { servers, stats };
}
export function decodeMCPServer(value: unknown): MCPServer { const v = object(value); return { config: object(v.config), status: text(v.status), tool_count: typeof v.tool_count === 'number' ? v.tool_count : undefined, error: text(v.error) }; }
export function parseMCPConfig(json: string, t: (key: string, options?: Record<string, unknown>) => string): Record<string, MCPConfig> {
  const value: unknown = JSON.parse(json); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('mcp.configMustBeObject'));
  const entries = Object.entries(value); if (!entries.length) throw new Error(t('mcp.configNeedOne'));
  const out: Record<string, MCPConfig> = {};
  for (const [name, item] of entries) {
    if (!name.trim()) throw new Error(t('mcp.configNameEmpty'));
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(t('mcp.configMustBeObj', { name }));
    const config: MCPConfig = { ...object(item) }; delete config.external_mcp_enable;
    const transport = config.type || config.transport || (config.command ? 'stdio' : config.url ? 'http' : '');
    if (!transport) throw new Error(t('mcp.configNeedCommand', { name }));
    if (transport === 'stdio' && !config.command) throw new Error(t('mcp.configStdioNeedCommand', { name }));
    if (transport === 'http' && !config.url) throw new Error(t('mcp.configHttpNeedUrl', { name }));
    if (transport === 'sse' && !config.url) throw new Error(t('mcp.configSseNeedUrl', { name }));
    Object.defineProperty(out, name, { value: config, writable: true, enumerable: true, configurable: true });
  }
  return out;
}
