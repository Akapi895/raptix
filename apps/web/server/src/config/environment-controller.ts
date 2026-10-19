import type { LifecycleConfig } from '../services/environments/environment-lifecycle.js';

export interface EnvironmentControllerConfig extends LifecycleConfig {
  controllerUrl: string;
  /** Read from a file; the token itself is never an environment value, a log line or an API response. */
  controllerToken: string;
}

const NAMES = {
  url: 'RAPTIX_ENVIRONMENT_CONTROLLER_URL',
  tokenFile: 'RAPTIX_ENVIRONMENT_CONTROLLER_TOKEN_FILE',
  runtimeImage: 'RAPTIX_ENVIRONMENT_RUNTIME_IMAGE',
  sandboxImage: 'RAPTIX_ENVIRONMENT_SANDBOX_IMAGE',
  workspaceRoot: 'RAPTIX_ENVIRONMENT_WORKSPACE_HOST_ROOT',
  stopTimeout: 'RAPTIX_ENVIRONMENT_STOP_TIMEOUT_SECONDS',
} as const;

const DIGEST_REF = /^[a-z0-9][a-z0-9._/:-]{0,199}@sha256:[a-f0-9]{64}$/;

/**
 * Returns undefined when no environment variable is set, so the deployment keeps the legacy path and the lifecycle
 * endpoints answer 503. A partial setting is a startup error that names the missing variables, never their values.
 */
export function loadEnvironmentControllerConfig(source: NodeJS.ProcessEnv, readToken: (path: string) => string): EnvironmentControllerConfig | undefined {
  const present = Object.values(NAMES).filter(name => (source[name] ?? '').trim() !== '');
  if (present.length === 0) return undefined;
  const missing = Object.values(NAMES).filter(name => name !== NAMES.stopTimeout && (source[name] ?? '').trim() === '');
  if (missing.length > 0) throw new Error(`Environment controller is partly configured; missing: ${missing.join(', ')}`);
  const runtimeImage = source[NAMES.runtimeImage]!.trim();
  const sandboxImage = source[NAMES.sandboxImage]!.trim();
  if (!DIGEST_REF.test(runtimeImage) || !DIGEST_REF.test(sandboxImage)) throw new Error(`${NAMES.runtimeImage} and ${NAMES.sandboxImage} must be digest-pinned references`);
  const stopTimeout = Number(source[NAMES.stopTimeout] ?? '30');
  if (!Number.isInteger(stopTimeout) || stopTimeout < 1 || stopTimeout > 300) throw new Error(`${NAMES.stopTimeout} must be an integer from 1 to 300`);
  const controllerToken = readToken(source[NAMES.tokenFile]!.trim()).trim();
  if (controllerToken.length < 32) throw new Error(`${NAMES.tokenFile} must contain a token of at least 32 bytes`);
  return {
    controllerUrl: source[NAMES.url]!.trim(),
    controllerToken,
    deploymentId: source.RAPTIX_WEB_DEPLOYMENT_ID?.trim() || 'default',
    runtimeImage,
    sandboxImage,
    workspaceHostRoot: source[NAMES.workspaceRoot]!.trim(),
    stopTimeoutSeconds: stopTimeout,
  };
}
