/**
 * Local single-user identity (new-backend port of the legacy auth-bridge —
 * reference only, no source import). There is no hosted authentication or
 * RBAC layer: every request resolves to the fixed local user. Never derive
 * roles, permissions or session objects here.
 */

export const LOCAL_USER_ID = 'local';

export interface LocalIdentity {
  /** Fixed single-user id; matches the DB default for engagement ownership. */
  readonly id: typeof LOCAL_USER_ID;
  readonly mode: 'local-single-user';
}

/** Resolve the request identity. Synchronous: there is no auth IO by design. */
export function getLocalIdentity(): LocalIdentity {
  return { id: LOCAL_USER_ID, mode: 'local-single-user' };
}
