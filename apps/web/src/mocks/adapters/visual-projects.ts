import { useSyncExternalStore } from 'react'
import type { Project } from '../../types'
import { PROJECTS } from '../fixtures/correct-projects'

const storageKey = 'raptix.correct.visual-projects.v1'
const listeners = new Set<() => void>()

function loadProjects(): Project[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (Array.isArray(saved) && saved.every(project => project && typeof project.id === 'string' && typeof project.name === 'string' && typeof project.scopeLabel === 'string' && Array.isArray(project.members) && ['active', 'completed', 'paused', 'planning'].includes(project.status))) return saved as Project[]
  } catch { /* Demo preferences are optional; source fixtures remain available. */ }
  return PROJECTS.map(project => ({ ...project, members: project.members.map(member => ({ ...member })) }))
}

let projects = loadProjects()

export function useVisualProjects(): Project[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => projects)
}

export function createVisualProject(name: string, scopeType: string, client: string): Project {
  if (!name.trim() || !scopeType || !client.trim()) throw new Error('Project name, scope type and client are required.')
  const project: Project = {
    id: crypto.randomUUID(), name: name.trim(), scopeLabel: `${client.trim()} — ${scopeType}`,
    scopeType, client: client.trim(), status: 'planning', currentPhase: 'Intake', myRole: 'Owner',
    findings: 0, assets: 0, agents: 0, startDate: new Date().toISOString().slice(0, 10), lastActivity: 'Just now',
    members: [{ id: 'm1', name: 'Alex Kim', initials: 'AK', email: 'alex.kim@raptix.io', role: 'Owner', status: 'active', lastActivity: 'Now' }],
  }
  projects = [project, ...projects]
  try { localStorage.setItem(storageKey, JSON.stringify(projects)) } catch { /* Demo still works within this session. */ }
  listeners.forEach(listener => listener())
  return project
}
