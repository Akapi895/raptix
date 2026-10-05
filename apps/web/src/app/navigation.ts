import type { Screen } from '../types'

export interface NavItem { id: Screen; label: string; path: string }
export interface NavGroup { id: string; label?: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { id: 'engagement', label: 'ENGAGEMENT', items: [
    { id: 'charter', label: 'Charter & ROE', path: 'charter' },
    { id: 'scope-boundaries', label: 'Scope & Boundary', path: 'scope' },
  ] },
  { id: 'execution', label: 'EXECUTION', items: [
    { id: 'operator-console', label: 'Operator Console', path: 'console' },
    { id: 'vector-campaigns', label: 'Vector Campaigns', path: 'campaigns' },
    { id: 'c2-sessions', label: 'C2 & Sessions', path: 'sessions' },
  ] },
  { id: 'data', label: 'INFRASTRUCTURE & DATA', items: [
    { id: 'infrastructure', label: 'Infrastructure & Data', path: 'infrastructure' },
    { id: 'assets', label: 'Assets & Inventory', path: 'assets' },
    { id: 'credentials', label: 'Credentials Vault', path: 'credentials' },
  ] },
  { id: 'outcomes', label: 'OUTCOMES', items: [
    { id: 'findings', label: 'Findings & Evidence', path: 'findings' },
    { id: 'logs', label: 'Operations Log', path: 'logs' },
    { id: 'reports', label: 'Reports', path: 'reports' },
  ] },
  { id: 'project', items: [
    { id: 'members', label: 'Members', path: 'members' },
    { id: 'project-settings', label: 'Settings', path: 'settings' },
  ] },
]

export const ACTIVE_NAV_ITEMS = NAV_GROUPS.flatMap(group => group.items)
export const SCREEN_LABELS: Record<Screen, string> = {
  projects: 'Projects', overview: 'Charter & ROE', charter: 'Charter & ROE',
  'scope-boundaries': 'Scope & Boundary', 'operator-console': 'Operator Console',
  'vector-campaigns': 'Vector Campaigns', 'c2-sessions': 'C2 & Sessions',
  infrastructure: 'Infrastructure & Data', assets: 'Assets & Inventory', credentials: 'Credentials Vault',
  findings: 'Findings & Evidence', logs: 'Operations Log', reports: 'Reports',
  members: 'Members', 'project-settings': 'Settings',
  // Retained type compatibility only; these screens have no routes or mounts.
  'agent-run': 'Operator Console', 'attack-graph': 'Infrastructure & Data',
  'knowledge-graph': 'Infrastructure & Data', evidence: 'Findings & Evidence',
}

// Compatibility for archived design helpers; active chrome is copied from web-correct.
export const OPERATOR_IDENTITY = { name: 'Alex Kim', initials: 'AK', role: 'Lead Pentester' } as const
