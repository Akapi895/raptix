/** Real asynchronous bootstrap must keep routing live under React StrictMode. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'

window.history.replaceState(null, '', '/?dataMode=real#/projects')
vi.stubEnv('VITE_DATA_MODE', 'real')
const { default: App } = await import('./App')
const { getActiveRouter } = await import('./router/active')
const { resetNavStores } = await import('./router/navigate')
const { useProjectStore } = await import('./state/stores')

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('retains the active router after StrictMode cleanup and follows hash navigation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/auth/session') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(url.endsWith('/capabilities')
    ? { version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true }, agents: { supported: false, available: false } } }
    : []), { status: 200 })))
  const ui = render(<StrictMode><App /></StrictMode>)
  await screen.findByRole('heading', { name: 'Projects' })
  expect(getActiveRouter()).not.toBeNull()
  await act(async () => { window.location.hash = '#/ai-operator/eng-1' })
  await screen.findByRole('heading', { name: 'AI Workspace' })
  ui.unmount()
  expect(getActiveRouter()).toBeNull()
})

it('opens the real task inbox instead of a transitional not-connected page', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/tasks')
  resetNavStores()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }))
    if (url.endsWith('/tasks')) return new Response(JSON.stringify({ engagements: [], tasks: [], counts: {}, source: 'db' }))
    if (url.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify([]))
  }))
  render(<App />)
  await screen.findByRole('heading', { name: 'Tasks' })
  expect(screen.queryByText('Not connected in real mode')).toBeNull()
})

const engagementDto = {
  id: 'eng-1',
  workspaceSlug: 'q1-external-assessment',
  displayName: 'Q1 External Assessment',
  targetType: 'web_url',
  targetValue: 'https://target.example.test',
  authorizationConfirmed: true,
  brief: 'Assess the public surface.',
  handoffConfirmedAt: null,
  metadataState: 'verified',
  lifecycleStatus: 'planning',
  findingCount: null,
  assetCount: null,
  activeAgentCount: null,
  createdAt: '2026-10-14T08:00:00.000Z',
  updatedAt: '2026-10-14T09:30:00.000Z',
}

it('replaces global navigation after opening a project from the portfolio and restores it on return', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/projects')
  resetNavStores()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }))
    if (url.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    if (url.endsWith('/api/engagements/eng-1')) return new Response(JSON.stringify(engagementDto))
    if (url.endsWith('/api/engagements')) return new Response(JSON.stringify([engagementDto]))
    return new Response(JSON.stringify([]))
  }))
  render(<App />)
  fireEvent.click(await screen.findByText('Q1 External Assessment'))
  await screen.findByRole('heading', { name: 'Overview' })
  expect(screen.getByRole('button', { name: 'All projects' })).toBeInTheDocument()
  for (const label of ['Overview', 'Planning', 'AI Workspace', 'Operations', 'Fleet', 'Sessions', 'Findings', 'Evidence', 'Analysis', 'Reports', 'Team & Approvals', 'Scope & ROE', 'Governance', 'Vault', 'Activity & Audit', 'Project Settings', 'Closeout']) {
    expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
  }
  expect(screen.queryByRole('button', { name: 'Capabilities' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Findings' }))
  await waitFor(() => expect(window.location.hash).toBe('#/project/eng-1?tab=findings'))
  expect(screen.getByRole('button', { name: 'Findings' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: 'Evidence' }))
  await waitFor(() => expect(window.location.hash).toBe('#/project/eng-1?tab=evidence'))
  expect(screen.getByRole('button', { name: 'Evidence' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: 'All projects' }))
  await screen.findByRole('heading', { name: 'Projects' })
  expect(screen.getByRole('button', { name: 'Capabilities' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'All projects' })).toBeNull()
})

it.each(['infrastructure', 'reports'])('keeps real global %s honest about missing aggregate sources', async (page) => {
  useProjectStore.getState().setPid('all')
  window.history.replaceState(null, '', `/?dataMode=real#/${page}`)
  resetNavStores()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true } } }))
    if (url.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    if (url.endsWith('/api/engagements')) return new Response(JSON.stringify([engagementDto]))
    if (url.endsWith('/api/engagements/eng-1')) return new Response(JSON.stringify(engagementDto))
    return new Response('{}', { status: 404 })
  }))
  render(<App />)
  expect(await screen.findByText('Global source unavailable')).toBeInTheDocument()
  expect(screen.queryByText('Select an engagement')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }))
  await waitFor(() => expect(window.location.hash).toContain('#/project/eng-1?tab='))
})

it('lists the real all-projects findings from the server read and opens a row in its finding detail', async () => {
  useProjectStore.getState().setPid('all')
  window.history.replaceState(null, '', '/?dataMode=real#/findings')
  resetNavStores()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/capabilities')) return new Response(JSON.stringify({ version: 1, mode: 'local-single-user', capabilities: { projects: { supported: true, available: true }, findings: { supported: true, available: true } } }))
    if (url.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    if (url.endsWith('/api/engagements')) return new Response(JSON.stringify([engagementDto]))
    if (url.endsWith('/api/engagements/eng-1')) return new Response(JSON.stringify(engagementDto))
    if (url.endsWith('/api/findings')) return new Response(JSON.stringify({
      findings: [{ id: 'fd-1', engagementId: 'eng-1', projectName: 'Northwind', targetValue: 'https://northwind.example.test', title: 'Exposed admin panel', severity: 'high', status: 'confirmed', sourceType: 'authored', description: 'Admin panel reachable without authentication.', techniqueId: 'T1190', createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-20T09:00:00.000Z' }],
      truncated: false,
      source: 'db',
    }))
    return new Response('{}', { status: 404 })
  }))
  render(<App />)
  expect(await screen.findByText('Exposed admin panel', undefined, { timeout: 15000 })).toBeInTheDocument()
  expect(screen.queryByText('Global source unavailable')).toBeNull()
  expect(screen.getByText('Project: Northwind')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Exposed admin panel'))
  await waitFor(() => expect(window.location.hash).toContain('#/finding/fd-1'))
}, 20_000)
