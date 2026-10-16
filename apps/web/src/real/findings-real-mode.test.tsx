/** The migrated findings screens render the mock UI over the real curated-findings API (ADR-0084). */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

window.history.replaceState(null, '', '/?dataMode=real#/findings')
vi.stubEnv('VITE_DATA_MODE', 'real')
const { default: App } = await import('../App')
const { resetNavStores } = await import('../router/navigate')
const { useProjectStore } = await import('../state/stores')

const engagement = {
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

function curated(id: string, title: string, status: string) {
  return {
    id, engagementId: 'eng-1', title, severity: 'high', status,
    body: { detail: `${title} detail.` }, expectedVersion: 1, sourceType: 'authored', producerRef: null,
    createdBy: 'local', updatedBy: null, updatedAt: '2026-10-14T09:00:00.000Z', evidence: [],
  }
}

const routes: Record<string, unknown> = {
  '/capabilities': {
    version: 1, mode: 'local-single-user', deploymentId: 'local',
    capabilities: {
      projects: { supported: true, available: true }, findings: { supported: true, available: true }, members: { supported: true, available: true },
    },
  },
  '/engagements': [engagement],
  '/engagements/eng-1': engagement,
  '/engagements/eng-1/members': { engagementId: 'eng-1', mode: 'local-single-user', members: [], inviteSupported: false, reason: null, source: 'db' },
  '/engagements/eng-1/curated-findings': {
    engagementId: 'eng-1', source: 'db', transitions: {},
    findings: [curated('CF-1', 'Admin panel exposed', 'draft'), curated('CF-2', 'Session fixation', 'review')],
  },
}

beforeEach(() => {
  resetNavStores()
  useProjectStore.getState().setPid('eng-1')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url, 'http://local').pathname.replace(/^\/api/, '')
    if (path.endsWith('/auth/session')) return new Response('{}', { status: 404 })
    const body = routes[path]
    return body === undefined ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(body), { status: 200 })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('lists the curated findings of the selected engagement and omits the unavailable AI tab', async () => {
  render(<App />)
  await screen.findByText('Admin panel exposed')
  expect(screen.getByText('Session fixation')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /AI Suggestions/ })).toBeNull()
  expect(screen.getByText('AI suggestions are not in the curated workflow yet')).toBeTruthy()
})

it('opens the create form with unsupported fields disabled and their registered reason shown', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/finding-new')
  render(<App />)
  const asset = await screen.findByLabelText(/Affected asset/)
  expect(asset).toBeDisabled()
  expect(screen.getByText('Findings are not linked to assets in the curated workflow yet.')).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Finding' })).toBeTruthy())
})
