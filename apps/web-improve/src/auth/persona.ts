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
import { USERS } from '../data'
import type { Role } from '../domain/entities'
import type { ActorRef } from '../domain/service'
import { useAuthStore } from '../state/stores'

/** Resolves the role for a persona name; unknown names are treated as viewer. */
export function personaRole(name: string): Role {
  return USERS.find((u) => u.name === name)?.role ?? 'viewer'
}

/** Actor reference for a persona name — the identity every authorization check uses. */
export function actorRef(name: string, role: Role = personaRole(name)): ActorRef {
  return { id: name, role }
}

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
