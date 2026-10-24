import { USERS } from './catalog'
import type { Role } from './entities'
import type { ActorRef } from './service'

/** Resolves the role for a persona name; unknown names are treated as viewer. */
export function personaRole(name: string): Role {
  return USERS.find((u) => u.name === name)?.role ?? 'viewer'
}

/** Actor reference for a persona name — the identity every authorization check uses. */
export function actorRef(name: string, role: Role = personaRole(name)): ActorRef {
  return { id: name, role }
}
