// The @-mention of a tool in the chat input: where the mention starts, what it filters, the order of its suggestions
// and the text it inserts. Pure: the DOM and the tool list are handled by the controller.

export interface MentionTool {
  name: string;
  description: string;
  enabled: boolean;
  /** Whether the tool is on for the current role; undefined when no role is selected. */
  roleEnabled?: boolean;
  isExternal: boolean;
  externalMcp: string;
  toolKey: string;
}

export interface MentionQuery {
  startIndex: number;
  query: string;
}

const MAX_QUERY_LENGTH = 60;
/** Characters that may sit right before an "@" without making it a mention. */
const BOUNDARY_PUNCTUATION = '([{\uff0c\u3002,.;:!?';

/** The mention being typed before the caret, or null when the caret is not inside one. */
export function mentionAtCaret(textBefore: string): MentionQuery | null {
  const atIndex = textBefore.lastIndexOf('@');
  if (atIndex === -1) return null;
  if (atIndex > 0) {
    const boundary = textBefore[atIndex - 1];
    if (boundary && !/\s/.test(boundary) && !BOUNDARY_PUNCTUATION.includes(boundary)) return null;
  }
  const query = textBefore.slice(atIndex + 1);
  if (/[\s@]/.test(query) || query.length > MAX_QUERY_LENGTH) return null;
  return { startIndex: atIndex, query: query.toLowerCase() };
}

/** Tools from different sources can share a name, so the key includes the external server. */
export function toolKeyForMention(tool: { name: string; isExternal?: boolean; externalMcp?: string }): string {
  if (tool.isExternal && tool.externalMcp) return `${tool.externalMcp}::${tool.name}`;
  return tool.name;
}

function enabledOnRole(tool: MentionTool): boolean {
  return tool.roleEnabled !== undefined ? tool.roleEnabled : tool.enabled;
}

/**
 * The tools a query matches. An exact server name lists that server's tools; a partial one also keeps the tools
 * of the servers it matches. Enabled tools come first, then exact server matches, then names that start with the query.
 */
export function filterMentionTools(tools: readonly MentionTool[], externalMcpNames: readonly string[], rawQuery: string): MentionTool[] {
  const query = (rawQuery || '').trim().toLowerCase();
  let filtered = tools.slice();

  if (query) {
    const exactServer = externalMcpNames.find(name => name.toLowerCase() === query);
    if (exactServer) {
      filtered = tools.filter(tool => !!tool.externalMcp && tool.externalMcp.toLowerCase() === exactServer.toLowerCase());
    } else {
      const partialServers = externalMcpNames.filter(name => name.toLowerCase().includes(query));
      filtered = tools.filter(tool => {
        const nameMatch = tool.name.toLowerCase().includes(query);
        const descriptionMatch = !!tool.description && tool.description.toLowerCase().includes(query);
        const serverMatch = !!tool.externalMcp && tool.externalMcp.toLowerCase().includes(query);
        const partialServerMatch = partialServers.some(name => !!tool.externalMcp && tool.externalMcp.toLowerCase() === name.toLowerCase());
        return nameMatch || descriptionMatch || serverMatch || partialServerMatch;
      });
    }
  }

  return filtered.sort((a, b) => {
    if (a.roleEnabled !== undefined || b.roleEnabled !== undefined) {
      if (enabledOnRole(a) !== enabledOnRole(b)) return enabledOnRole(a) ? -1 : 1;
    }
    if (query) {
      const aServerExact = !!a.externalMcp && a.externalMcp.toLowerCase() === query;
      const bServerExact = !!b.externalMcp && b.externalMcp.toLowerCase() === query;
      if (aServerExact !== bServerExact) return aServerExact ? -1 : 1;
      const aStarts = a.name.toLowerCase().startsWith(query);
      const bStarts = b.name.toLowerCase().startsWith(query);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
    }
    if (enabledOnRole(a) !== enabledOnRole(b)) return enabledOnRole(a) ? -1 : 1;
    return a.name.localeCompare(b.name, 'en-US');
  });
}

export interface MentionInsertion {
  value: string;
  caret: number;
}

/** Replaces the mention being typed (from its "@" up to the caret) with the chosen tool. */
export function insertMention(value: string, startIndex: number, caret: number, toolName: string): MentionInsertion {
  const before = value.slice(0, startIndex);
  const after = value.slice(caret);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const insertText = `@${toolName}` + (needsSpace ? ' ' : '');
  return { value: before + insertText + after, caret: before.length + insertText.length };
}

/** Maps one tool of the tools API to the mention shape. */
export function mentionToolFromApi(raw: {
  name?: unknown; description?: unknown; enabled?: unknown; role_enabled?: unknown; is_external?: unknown; external_mcp?: unknown;
}): MentionTool | null {
  if (!raw || !raw.name) return null;
  const name = String(raw.name);
  const externalMcp = raw.external_mcp ? String(raw.external_mcp) : '';
  const isExternal = !!raw.is_external;
  const roleEnabled = raw.role_enabled !== undefined && raw.role_enabled !== null ? !!raw.role_enabled : raw.enabled !== false;
  return {
    name,
    description: raw.description ? String(raw.description) : '',
    enabled: raw.enabled !== false,
    roleEnabled,
    isExternal,
    externalMcp,
    toolKey: toolKeyForMention({ name, isExternal, externalMcp }),
  };
}

export interface ExternalServerState {
  status?: string;
  config?: { external_mcp_enable?: boolean; enabled?: boolean; disabled?: boolean };
}

/** The external servers that are connected and turned on; only their tools are offered for mention. */
export function connectedExternalServers(servers: Record<string, ExternalServerState> | undefined): string[] {
  return Object.keys(servers || {}).filter(name => {
    const server = servers?.[name];
    const config = server?.config;
    return server?.status === 'connected' && (!!config?.external_mcp_enable || (!!config?.enabled && !config?.disabled));
  });
}
