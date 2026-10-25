import { EnvValidationError } from './env.js';

export const RUNTIME_API_TOKEN_FILE = 'RAPTIX_RUNTIME_API_TOKEN_FILE';

/**
 * Required whenever the runtime is configured. The LangGraph API refuses callers without this token (interfaces/api/auth.py),
 * so the web API must hold it. The value is read from a file that sandboxes never receive, and it is never logged.
 */
export function loadRuntimeApiToken(source: NodeJS.ProcessEnv, readFile: (path: string) => string): string {
  const path = (source[RUNTIME_API_TOKEN_FILE] ?? '').trim();
  if (path === '') throw new EnvValidationError([`The runtime API is authenticated; set ${RUNTIME_API_TOKEN_FILE} to its token file`]);
  const token = readFile(path).trim();
  if (token.length < 32) throw new EnvValidationError(['The runtime API token must be at least 32 bytes']);
  return token;
}
