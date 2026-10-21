/** Narrow synchronous identity and project-policy reads over the console services. */
import { USERS } from '../domain/catalog';
import { type Project } from '../domain/entities'
import type { ActorRef } from '../domain/service'
import type { ConsoleServices } from '../domain/service-factory'
import type { DbAuthority } from '../domain/database'

export type Persona = (typeof USERS)[number]

export function readPersona(services: ConsoleServices, name: string): Persona {
  return services.identity.persona(name)
}

export interface IdentityService {
  persona(name: string): Persona
  projects(): Project[]
  dispose(): void
}

export function createIdentityService(authority: DbAuthority): IdentityService {
  let members = authority.snapshot().org.members
  let projects = authority.snapshot().projects
  const off = authority.subscribe(() => {
    const next = authority.snapshot()
    members = next.org.members
    projects = next.projects
  })
  const persona = (name: string): Persona => {
    const base = USERS.find((u) => u.name === name)!
    const role = members[name]?.role
    if (!role || role === base.role) return base
    const key = `${name}:${role}`
    let resolved = overridden.get(key)
    if (!resolved) { resolved = { ...base, role }; overridden.set(key, resolved) }
    return resolved
  }
  return { persona, projects: () => projects, dispose: off }
}
const overridden = new Map<string, Persona>()

export function readActor(services: ConsoleServices, name: string): ActorRef {
  const me = readPersona(services, name)
  return { id: me.name, role: me.role }
}

export function readPolicyProjects(services: ConsoleServices): Project[] {
  return services.identity.projects()
}
