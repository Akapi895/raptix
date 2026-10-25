/**
 * Trusted real-mode identity constants (integration ticket 03, D1).
 *
 * A leaf module (no imports) so the query keys and the console read seam can
 * reference the identity without creating an import cycle through the
 * bootstrap component tree. The `role` value only feeds the policy helpers
 * for UI hints; the server enforces every real authorization.
 */

export interface RealIdentity {
  readonly id: 'local'
  readonly name: string
  readonly deploymentMode: string
}

export const REAL_IDENTITY: RealIdentity = { id: 'local', name: 'Local Operator', deploymentMode: 'local-single-user' }

/** Identity hints for the local operator until a session actor resolves (ADR-0100). */
export const REAL_PERSONA = { name: REAL_IDENTITY.name, email: 'local@raptix.local', role: 'admin' } as const
