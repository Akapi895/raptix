import { useSyncExternalStore } from 'react'
import { PROJECTS } from '../fixtures/projects'
import type { CreateProjectInput, Project } from '../../types'

const storageKey = 'raptix.mock.projects.v1'
const listeners = new Set<() => void>()
let persistenceError: string | null = null

function isProject(candidate: unknown): candidate is Project {
  if (!candidate || typeof candidate !== 'object') return false
  const project = candidate as Record<string, unknown>
  return ['id', 'name', 'scopeLabel', 'scopeType', 'currentPhase', 'startDate', 'client', 'lastActivity'].every(field => typeof project[field] === 'string')
    && ['active', 'completed', 'paused', 'planning'].includes(String(project.status))
    && ['findings', 'assets', 'agents'].every(field => typeof project[field] === 'number' && Number.isFinite(project[field]) && Number(project[field]) >= 0)
    && Array.isArray(project.members)
}

function normalizeProject(project: Project): Project {
  return { ...project, members: [], myRole: 'Owner', findings: project.id === '1' ? 13 : 0, assets: project.id === '1' ? 12 : 0 }
}

function initialProjects(): Project[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (Array.isArray(saved) && saved.every(isProject)) return saved.map(normalizeProject)
    if (saved !== null) persistenceError = 'Saved demo project schema is invalid. Using the bundled demo projects instead.'
  } catch {
    persistenceError = 'Demo storage could not be read. Changes will remain in this session.'
  }
  return PROJECTS.map(project => normalizeProject({ ...project, workspaceSlug: `demo-${project.id}`, authorizationConfirmed: true }))
}

let projects = initialProjects()

function publish(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(projects))
    persistenceError = null
  } catch {
    persistenceError = 'Demo changes are session-only because browser storage is unavailable.'
  }
  listeners.forEach(listener => listener())
}

export function useMockProjects(): Project[] {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => projects)
}

export function getProjectPersistenceError(): string | null {
  return persistenceError
}

export function createMockProject(input: CreateProjectInput): Project {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.workspaceSlug)) throw new Error('Use lowercase letters, numbers and single hyphens for the workspace slug.')
  if (projects.some(project => project.workspaceSlug === input.workspaceSlug)) throw new Error('This workspace slug already exists. Choose another slug.')
  if (!input.displayName.trim() || !input.targetValue.trim() || !input.authorizationConfirmed) throw new Error('Name, target and authorization confirmation are required.')
  if (input.targetType === 'web_url') {
    let target: URL
    try { target = new URL(input.targetValue) } catch { throw new Error('Enter a valid HTTP or HTTPS target URL.') }
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Enter a valid HTTP or HTTPS target URL.')
  } else if (input.targetType !== 'ip_range' || !/^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/.test(input.targetValue) || input.targetValue.split('/')[0].split('.').some(octet => Number(octet) > 255)) {
    throw new Error('Enter a valid IPv4 target address or CIDR range.')
  }
  const project: Project = {
    id: crypto.randomUUID(), name: input.displayName.trim(), workspaceSlug: input.workspaceSlug,
    targetType: input.targetType, targetValue: input.targetValue.trim(), authorizationConfirmed: true,
    scopeLabel: input.targetValue.trim(), scopeType: input.targetType === 'web_url' ? 'Web Application' : 'Network Infrastructure',
    client: 'Local engagement', status: 'planning', currentPhase: 'Intake', myRole: 'Owner',
    findings: 0, assets: 0, agents: 0, members: [], startDate: new Date().toISOString().slice(0, 10), lastActivity: 'Just now',
  }
  projects = [project, ...projects]
  publish()
  return project
}

export function updateMockProject(id: string, patch: { name: string }): void {
  if (!patch.name.trim()) throw new Error('Display name is required.')
  projects = projects.map(project => project.id === id ? { ...project, name: patch.name.trim() } : project)
  publish()
}
