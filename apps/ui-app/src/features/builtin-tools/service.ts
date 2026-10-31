/** Legacy UI metadata subset; these names match internal/mcp/builtin/constants.go. */
export const BuiltinTools = {
  RECORD_VULNERABILITY: 'record_vulnerability',
  LIST_KNOWLEDGE_RISK_TYPES: 'list_knowledge_risk_types',
  SEARCH_KNOWLEDGE_BASE: 'search_knowledge_base',
} as const;
export type BuiltinToolName = typeof BuiltinTools[keyof typeof BuiltinTools];
export function getAllBuiltinTools(): BuiltinToolName[] { return Object.values(BuiltinTools); }
export function isBuiltinTool(name: unknown): name is BuiltinToolName {
  return getAllBuiltinTools().some(tool => tool === name);
}
