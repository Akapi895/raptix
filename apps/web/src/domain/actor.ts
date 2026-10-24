import type { Role } from './entities'
import type { ActorRef } from './service'

/** Actor reference for a signed-in identity and role — the identity every authorization check uses. */
export function actorRef(name: string, role: Role): ActorRef {
  return { id: name, role }
}
