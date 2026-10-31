/** A project's sandbox could not be started. The launcher's reason stays on the host; the caller gets this only. */
export class SandboxProvisionError extends Error {
  constructor(
    message = "The project sandbox could not be started. The project was not created; retry when the sandbox controller is available.",
  ) {
    super(message);
    this.name = "SandboxProvisionError";
  }
}

/**
 * Port for starting a project's own sandbox container (ADR-0086 A). Routes are
 * never given the concrete client -- they go through this port.
 */
export interface SandboxProvisioner {
  /** Resolves once the project's sandbox container is healthy. Any other outcome is a provisioning failure. */
  ensure(slug: string): Promise<void>;
}

// The API runs in a container and reaches the host controller through host.docker.internal.
const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|\[::1\]|host\.docker\.internal):\d{1,5}$/;
// Starting a sandbox waits for its container to become healthy, so the budget is longer than a plain request.
const PROVISION_TIMEOUT_MS = 180_000;

/**
 * Authenticated client for the host sandbox controller (`raptix web sandboxes serve`). It speaks one operation, on a
 * loopback address, with a bearer token that never leaves this process. Ported from the retired apps/web/server's
 * integrations/sandboxes/sandbox-controller-client.ts (recoverable from git history prior to the ADR-0106 deletion
 * commit) -- same protocol, so the launcher's controller (apps/launcher/internal/sandboxes/controller.go) is unchanged.
 */
export class LauncherSandboxController implements SandboxProvisioner {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = PROVISION_TIMEOUT_MS,
  ) {
    if (!LOOPBACK_HTTP.test(baseUrl)) {
      throw new Error("The sandbox controller must be a loopback address or host.docker.internal.");
    }
    if (token.length < 32) throw new Error("The sandbox controller token must be at least 32 bytes.");
  }

  public async ensure(slug: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/sandboxes/ensure`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ slug }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      throw new SandboxProvisionError();
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== 200) throw new SandboxProvisionError();
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (body?.status !== "ready") throw new SandboxProvisionError();
  }
}

/** Used when the sandbox controller is not configured -- project creation fails 503 honestly instead of leaving a project without its sandbox. */
export class UnconfiguredSandboxProvisioner implements SandboxProvisioner {
  public ensure(): Promise<void> {
    return Promise.reject(
      new SandboxProvisionError(
        "Project sandboxes are not configured for this deployment (RAPTIX_SANDBOX_CONTROLLER_URL / RAPTIX_SANDBOX_CONTROLLER_TOKEN_FILE).",
      ),
    );
  }
}
