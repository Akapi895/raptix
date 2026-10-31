import { createHmac } from "node:crypto";

/**
 * Per-project sandboxes (ADR-0086 A, ADR-0102). Each project runs in its own
 * sandbox container, named from its slug, mounting only that project's
 * /workspace. Ported from the retired apps/web/server's
 * services/runtime/sandbox-routing.ts (recoverable from git history prior
 * to the ADR-0106 deletion commit) -- same construction, so the launcher's
 * `TokenFor` (apps/launcher/internal/sandboxes/secrets.go) still derives a
 * matching token.
 */
export const SANDBOX_PORT = 9999;
const HOST_PREFIX = "sbx-";
const MAX_DNS_LABEL = 63;

export class SandboxSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxSlugError";
  }
}

export function sandboxHostFor(slug: string): string {
  const host = `${HOST_PREFIX}${slug}`;
  if (host.length > MAX_DNS_LABEL) {
    throw new SandboxSlugError(
      `The project slug is too long for a per-project sandbox (${host.length} > ${MAX_DNS_LABEL} characters).`,
    );
  }
  return host;
}

export function sandboxUrlFor(slug: string): string {
  return `http://${sandboxHostFor(slug)}:${SANDBOX_PORT}`;
}

/**
 * The bearer token of one project's sandbox. The launcher derives the same
 * value from the same key when it starts that sandbox, so a run can
 * authenticate to its own project's sandbox and to no other. The key never
 * reaches a sandbox or the runtime.
 */
export function sandboxTokenFor(key: string, slug: string): string {
  return createHmac("sha256", key).update(`sandbox-token:${slug}`).digest("hex");
}
