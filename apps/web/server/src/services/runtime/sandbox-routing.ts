/**
 * Per-project sandboxes (ADR-0086 A). Each project runs in its own sandbox
 * container, named from its slug, which mounts only that project's directory
 * at the same path the runtime and API use (`/workspace/<slug>`). The run's
 * sandbox URL is derived here, so the server never trusts a URL from a caller.
 *
 * The host name must match the container the launcher creates (`sbx-<slug>`).
 */
import { ProjectApiError } from '../projects-service.js';

export const SANDBOX_PORT = 9999;
const HOST_PREFIX = 'sbx-';
const MAX_DNS_LABEL = 63;

/** The DNS host of a project's sandbox container. Throws when the slug cannot fit a DNS label. */
export function sandboxHostFor(slug: string): string {
  const host = `${HOST_PREFIX}${slug}`;
  if (host.length > MAX_DNS_LABEL) {
    throw new ProjectApiError(409, `The project slug is too long for a per-project sandbox (${host.length} > ${MAX_DNS_LABEL} characters).`);
  }
  return host;
}

export function sandboxUrlFor(slug: string): string {
  return `http://${sandboxHostFor(slug)}:${SANDBOX_PORT}`;
}
