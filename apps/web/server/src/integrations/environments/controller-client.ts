import { ProjectApiError } from '../../services/projects-service.js';

export type ControllerOperation = 'ensure' | 'start' | 'observe' | 'stop' | 'recreate' | 'remove';
export type ControllerRole = 'runtime' | 'sandbox';

export interface ControllerIdentity {
  deploymentId: string;
  projectId: string;
  environmentId: string;
  role: ControllerRole;
  generation: number;
}

export interface ControllerRequest {
  identity: ControllerIdentity;
  image?: string;
  workspaceSlug?: string;
  workspaceHostPath?: string;
  stopTimeoutSeconds?: number;
}

export interface ControllerObservation {
  name: string;
  exists: boolean;
  running: boolean;
  generation: number;
  /** docker's health status when the image declares a check: starting, healthy or unhealthy; empty otherwise. */
  health?: string;
}

/** The controller is unreachable, slow, or answered something it should not. The outcome is unknown. */
export class ControllerUnavailableError extends ProjectApiError {
  public constructor() { super(503, 'The environment controller is unavailable.'); }
}

/** The controller refused the operation with a stable code. Docker's own error text is never passed on. */
export class ControllerRefusedError extends ProjectApiError {
  public constructor(public readonly code: string, statusCode: number) {
    super(statusCode, `The environment controller refused the operation (${code}).`);
  }
}

// The API runs in a container, so it reaches the host controller through host.docker.internal, which Docker maps to the host loopback.
const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|\[::1\]|host\.docker\.internal):\d{1,5}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 120_000;

/**
 * Authenticated client for the host controller (apps/launcher/internal/environments). It speaks only the six
 * allowlisted operations, on a loopback address, with a bearer token that never leaves this process.
 */
export class HostControllerClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!LOOPBACK_HTTP.test(baseUrl)) throw new Error('The environment controller must be a loopback address or host.docker.internal.');
    if (token.length < 32) throw new Error('The environment controller token must be at least 32 bytes.');
  }

  public async call(op: ControllerOperation, body: ControllerRequest): Promise<ControllerObservation> {
    const controller = new AbortController();
    // A stop waits for docker to stop a process that may ignore SIGTERM, so it gets a longer budget than other calls.
    const budget = op === 'stop' ? Math.max(this.timeoutMs, STOP_TIMEOUT_MS) : this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), budget);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/environments/${op}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      throw new ControllerUnavailableError();
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => '');
    if (text.length > 64 * 1024) throw new ControllerUnavailableError();
    let parsed: { status?: unknown; observation?: unknown; error?: unknown } = {};
    try { parsed = text.length ? JSON.parse(text) as typeof parsed : {}; } catch { throw new ControllerUnavailableError(); }
    if (response.ok && parsed.status === 'ok' && isObservation(parsed.observation)) return parsed.observation;
    if (typeof parsed.error === 'string' && /^[a-z_]{1,40}$/.test(parsed.error)) throw new ControllerRefusedError(parsed.error, response.status);
    throw new ControllerUnavailableError();
  }
}

function isObservation(value: unknown): value is ControllerObservation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && typeof v.exists === 'boolean' && typeof v.running === 'boolean' && typeof v.generation === 'number' && (v.health === undefined || typeof v.health === 'string');
}
