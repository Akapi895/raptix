import { EnvValidationError } from './env.js';

export interface SandboxControllerConfig {
  controllerUrl: string;
  /** Read from a file; it authenticates this API to the host sandbox controller and is never logged or returned. */
  controllerToken: string;
  /** Read from a file; it derives each project's sandbox token. Sandboxes and runtimes never receive it. */
  sandboxKey: string;
}

const NAMES = {
  url: 'RAPTIX_SANDBOX_CONTROLLER_URL',
  tokenFile: 'RAPTIX_SANDBOX_CONTROLLER_TOKEN_FILE',
  keyFile: 'RAPTIX_SANDBOX_KEY_FILE',
} as const;

/**
 * Required whenever the database is configured: every project is provisioned with its own sandbox when it is created,
 * so a server without the controller cannot create a project at all. Errors name the variables, never their values.
 */
export function loadSandboxControllerConfig(source: NodeJS.ProcessEnv, readFile: (path: string) => string): SandboxControllerConfig {
  const missing = Object.values(NAMES).filter(name => (source[name] ?? '').trim() === '');
  if (missing.length > 0) throw new EnvValidationError([`Project sandboxes are required; set ${missing.join(', ')}`]);
  const controllerToken = readFile(source[NAMES.tokenFile]!.trim()).trim();
  const sandboxKey = readFile(source[NAMES.keyFile]!.trim()).trim();
  if (controllerToken.length < 32 || sandboxKey.length < 32) throw new EnvValidationError(['Sandbox controller token and sandbox key must each be at least 32 bytes']);
  return { controllerUrl: source[NAMES.url]!.trim(), controllerToken, sandboxKey };
}
