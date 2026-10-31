/**
 * Pure permission rules shared by navigation, controls and the service. Kept free of
 * DOM and storage access so the rules can be unit-tested directly.
 */

/** Navigation page id -> permission required to see it. Mirrors the server catalog. */
export const PAGE_PERMISSION_MAP: Readonly<Record<string, string>> = {
  dashboard: 'dashboard:read',
  chat: 'chat:read',
  hitl: 'hitl:read',
  'tool-guard': 'config:read',
  'info-collect': 'fofa:execute',
  assets: 'asset:read',
  'asset-overview': 'asset:read',
  'asset-library': 'asset:read',
  tasks: 'tasks:read',
  workflows: 'workflow:read',
  projects: 'project:read',
  vulnerabilities: 'vulnerability:read',
  'chat-files': 'files:read',
  webshell: 'webshell:read',
  c2: 'c2:read',
  'c2-listeners': 'c2:read',
  'c2-sessions': 'c2:read',
  'c2-tasks': 'c2:read',
  'c2-activity': 'c2:read',
  'c2-payloads': 'c2:read',
  'c2-events': 'c2:read',
  'c2-profiles': 'c2:read',
  mcp: 'mcp:read',
  'mcp-monitor': 'monitor:read',
  'mcp-management': 'mcp:read',
  knowledge: 'knowledge:read',
  'knowledge-retrieval-logs': 'knowledge:read',
  'knowledge-management': 'knowledge:read',
  skills: 'skills:read',
  'skills-monitor': 'skills:read',
  'skills-management': 'skills:read',
  'roles-management': 'roles:read',
  settings: 'config:read',
};

export type PermissionCheck = (permission: string) => boolean;

export function hasAnyPermission(has: PermissionCheck, permissions: readonly string[]): boolean {
  if (permissions.length === 0) return true;
  return permissions.some(permission => has(permission));
}

/**
 * Explicit element rules win over the page map. `data-require-permission-any` takes
 * precedence over the single-permission attribute, matching the server-side guard.
 */
export interface AttributeSource {
  getAttribute(name: string): string | null;
}

export function elementAllowed(has: PermissionCheck, element: AttributeSource | null): boolean {
  if (!element) return true;
  const anyOf = element.getAttribute('data-require-permission-any');
  if (anyOf) {
    return hasAnyPermission(has, anyOf.split(/[\s,|]+/).map(item => item.trim()).filter(Boolean));
  }
  const permission = element.getAttribute('data-require-permission');
  return permission ? has(permission) : true;
}

export function pagePermission(page: string | null | undefined): string | undefined {
  return page ? PAGE_PERMISSION_MAP[page] : undefined;
}

export function requiresPermissionElement(element: AttributeSource & { hasAttribute(name: string): boolean }): boolean {
  return element.hasAttribute('data-require-permission') || element.hasAttribute('data-require-permission-any');
}
