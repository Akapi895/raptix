import * as path from 'node:path';
import { EnvValidationError } from './env.js';
import { isProjectSlug } from '../security/project-policy.js';

export interface RuntimeConfig {
  apiUrl: string; workspaceRoot: string; pinnedSlug?: string
  assistants: readonly string[]; language?: string; sandboxUrl?: string
}
function url(value: string): string {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid URL');
    return parsed.href.replace(/\/$/, '');
  } catch { throw new EnvValidationError(['Runtime URLs must be HTTP(S), without credentials, query or fragment']); }
}
export function loadRuntimeConfig(source: NodeJS.ProcessEnv): RuntimeConfig | undefined {
  if (source.LANGGRAPH_API_URL === undefined) {
    if (['RAPTIX_RUNTIME_WORKSPACE_ROOT', 'RAPTIX_RUNTIME_WORKSPACE_SLUG', 'RAPTIX_RUNTIME_LANGUAGE', 'RAPTIX_RUNTIME_SANDBOX_URL', 'RAPTIX_RUNTIME_ASSISTANTS'].some(k => source[k] !== undefined)) throw new EnvValidationError(['LANGGRAPH_API_URL is required for runtime configuration']);
    return undefined;
  }
  const root = source.RAPTIX_RUNTIME_WORKSPACE_ROOT ?? '';
  if (!root.startsWith('/') || root !== '/' && root.endsWith('/') || root.includes('\\') || path.posix.normalize(root) !== root || root.split('/').includes('..') || /[\x00-\x1f]/.test(root)) throw new EnvValidationError(['RAPTIX_RUNTIME_WORKSPACE_ROOT must be an explicit canonical POSIX absolute path']);
  const pinnedSlug = source.RAPTIX_RUNTIME_WORKSPACE_SLUG;
  if (pinnedSlug !== undefined && !isProjectSlug(pinnedSlug)) throw new EnvValidationError(['Invalid RAPTIX_RUNTIME_WORKSPACE_SLUG']);
  const assistants = (source.RAPTIX_RUNTIME_ASSISTANTS ?? 'soundwave,decepticon,raptix,vulnresearch').split(',');
  if (!assistants.length || assistants.some(a => !/^[a-z][a-z0-9_-]{0,63}$/.test(a))) throw new EnvValidationError(['Invalid RAPTIX_RUNTIME_ASSISTANTS allowlist']);
  const language = source.RAPTIX_RUNTIME_LANGUAGE;
  if (language !== undefined && !/^[a-z]{2}$/.test(language)) throw new EnvValidationError(['RAPTIX_RUNTIME_LANGUAGE must be a two-letter language code']);
  return { apiUrl: url(source.LANGGRAPH_API_URL), workspaceRoot: root, assistants: [...new Set(assistants)], ...(pinnedSlug === undefined ? {} : { pinnedSlug }), ...(language === undefined ? {} : { language }), ...(source.RAPTIX_RUNTIME_SANDBOX_URL === undefined ? {} : { sandboxUrl: url(source.RAPTIX_RUNTIME_SANDBOX_URL) }) };
}
