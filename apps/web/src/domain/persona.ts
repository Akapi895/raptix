import type { Role } from './entities'

/**
 * The persona the console shows: the signed-in actor's display identity and role. The role feeds UI hints only; the server
 * enforces every authorization.
 */
export interface Persona {
  name: string
  email: string
  role: Role
}
