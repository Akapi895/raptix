import { ProjectApiError } from '../../services/projects-service.js';

/** A project's sandbox could not be started. The launcher's reason stays on the host; the caller gets this only. */
export class SandboxProvisionError extends ProjectApiError {
  public constructor() { super(503, 'The project sandbox could not be started. The project was not created; retry when the sandbox controller is available.'); }
}

// The API runs in a container and reaches the host controller through host.docker.internal, as the environment controller does.
const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|\[::1\]|host\.docker\.internal):\d{1,5}$/;
// Starting a sandbox waits for its container to become healthy, so the budget is longer than a plain request.
const PROVISION_TIMEOUT_MS = 180_000;

/**
 * Authenticated client for the host sandbox controller (`raptix web sandboxes serve`). It speaks one operation, on a
 * loopback address, with a bearer token that never leaves this process.
 */
export class SandboxController {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = PROVISION_TIMEOUT_MS,
  ) {
    if (!LOOPBACK_HTTP.test(baseUrl)) throw new Error('The sandbox controller must be a loopback address or host.docker.internal.');
    if (token.length < 32) throw new Error('The sandbox controller token must be at least 32 bytes.');
  }

  /** Resolves once the project's sandbox container is healthy. Any other outcome is a provisioning failure. */
  public async ensure(slug: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/sandboxes/ensure`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch {
      throw new SandboxProvisionError();
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== 200) throw new SandboxProvisionError();
    const body = await response.json().catch(() => null) as { status?: unknown } | null;
    if (body?.status !== 'ready') throw new SandboxProvisionError();
  }
}
