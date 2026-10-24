/**
 * Auth feature actions (ticket 06, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Persona sign-in, switch and sign-out write through the shared auth store
 * (ticket 05) — the single authority legacy and migrated consumers both
 * observe. The login screen uses these actions for persona selection and the
 * legacy store forwards its `login`/`logout` here; navigation stays with the
 * legacy shell until the router migration (ticket 07).
 */
import { USERS } from '../domain/catalog';
import { useAuthStore } from '../state/stores'

/** Simulated personas the agent screens offer as group owners (everyone but viewers). */
export const OWNER_PERSONAS = USERS.filter((u) => u.role !== 'viewer')

/** Simulated personas the agent screens offer as reviewers. */
export const REVIEWER_PERSONAS = USERS.filter((u) => ['reviewer', 'manager', 'admin'].includes(u.role))

/** Signs the persona in, optionally selecting the organization/workspace. */
export function signIn(name: string, org?: string): void {
  const auth = useAuthStore.getState()
  auth.setMe(name)
  if (org) auth.setOrg(org)
  auth.setAuthed(true)
}

/** Switches the active persona inside an authenticated session. */
export function switchPersona(name: string): void {
  useAuthStore.getState().setMe(name)
}

/** Ends the session; navigating to the login screen stays with the shell (ticket 07). */
export function signOut(): void {
  useAuthStore.getState().setAuthed(false)
}
