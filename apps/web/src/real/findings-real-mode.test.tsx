/** The migrated findings screens render the mock UI over the real curated-findings API (ADR-0084). */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CuratedFindingView } from './api'

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

function curated(id: string, title: string, status: CuratedFindingView['status']): CuratedFindingView {
  return {
    id, engagementId: 'eng-1', title, severity: 'high', status,
    body: { detail: `${title} detail.` }, expectedVersion: 1, sourceType: 'authored', producerRef: null,
    createdBy: 'local', updatedBy: null, createdAt: '2026-10-14T09:00:00.000Z', updatedAt: '2026-10-14T09:00:00.000Z', producerDigest: null, lastReviewDecision: null, comments: [], history: [], retests: [], evidence: [],
    references: { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, activityCursors: { comments: null, history: null, retests: null },
  }
}

const producerFinding = {
  engagementId: 'eng-1', id: 'FIND-001', title: 'Producer claim', severity: 'medium',
  description: 'Observed by the runtime.', evidence: 'See retained output.', attackVector: 'Unknown',
  affectedAssets: ['10.129.227.140'],
  quality: { defaultSeverity: true, placeholderDescription: false, placeholderEvidence: false, unreadable: false },
  rawSource: '# Producer claim', sizeBytes: 128, source: 'workspace',
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
  '/engagements/eng-1/members': { engagementId: 'eng-1', mode: 'multi-user', members: [{ id: 'local', label: 'Local Operator', role: 'owner', source: 'membership' }], inviteSupported: true, reason: null, source: 'db' },
  '/engagements/eng-1/curated-findings': {
    engagementId: 'eng-1', source: 'db', transitions: {},
    findings: [curated('CF-1', 'Admin panel exposed', 'draft'), curated('CF-2', 'Session fixation', 'review')],
  },
  '/engagements/eng-1/curated-findings/suggestions': { engagementId: 'eng-1', dispositions: [] },
  '/engagements/eng-1/findings': { engagementId: 'eng-1', findings: [producerFinding], truncated: false, source: 'workspace' },
  '/engagements/eng-1/artifacts/captures': { engagementId: 'eng-1', captures: [], source: 'db' },
}
let retainedCaptures: Record<string, unknown>[] = []
let suggestionDispositions: { producerRef: string; dismissed: boolean; reason: string | null; version: number }[] = []
const apiCalls: string[] = []
const commentRequests: { text: string; requestId: string; expectedVersion: number }[] = []
let loseCommentAck = false
const CAPTURE_SHA256 = '38164fbd17603d73f696b8b4d72664d735bb6a7c88577687fd2ae33fd6964153'

beforeEach(() => {
  window.history.replaceState(null, '', '/?dataMode=real#/findings')
  resetNavStores()
  useProjectStore.getState().setPid('eng-1')
  ;(routes['/engagements/eng-1/curated-findings'] as { findings: unknown[] }).findings = [curated('CF-1', 'Admin panel exposed', 'draft'), curated('CF-2', 'Session fixation', 'review')]
  retainedCaptures = []
  suggestionDispositions = []
  apiCalls.length = 0
  commentRequests.length = 0
  loseCommentAck = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://local').pathname.replace(/^\/api/, '')
    apiCalls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path.endsWith('/auth/session')) return new Response(JSON.stringify({ authenticated: true, actor: { id: 'local', username: 'local', displayName: 'Local Operator' }, csrfToken: 'csrf-test', mode: 'multi-user' }), { status: 200 })
    if (path.endsWith('/curated-findings/options')) return new Response(JSON.stringify({ engagementId: 'eng-1', assets: [{ id: 'asset-1', label: 'web-01' }], executions: [], techniqueAvailable: true, truncated: false }), { status: 200 })
    if (path.endsWith('/curated-findings/suggestions') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as { producerRef: string; dismissed: boolean; reason: string; expectedVersion: number }
      const current = suggestionDispositions.find((row) => row.producerRef === input.producerRef)
      const version = current?.version ?? 0
      if (version !== input.expectedVersion) return new Response(JSON.stringify({ error: { code: 'conflict', message: 'The suggestion disposition changed.' } }), { status: 409 })
      const disposition = { producerRef: input.producerRef, dismissed: input.dismissed, reason: input.reason || null, version: version + 1 }
      suggestionDispositions = current ? suggestionDispositions.map((row) => row.producerRef === input.producerRef ? disposition : row) : [...suggestionDispositions, disposition]
      return new Response(JSON.stringify({ engagementId: 'eng-1', disposition }), { status: 200 })
    }
    if (path.endsWith('/curated-findings/suggestions')) return new Response(JSON.stringify({ engagementId: 'eng-1', dispositions: suggestionDispositions }), { status: 200 })
    if (path.endsWith('/curated-findings/CF-1/comments') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as typeof commentRequests[number]
      const list = routes['/engagements/eng-1/curated-findings'] as { findings: CuratedFindingView[] }
      const finding = list.findings[0]!
      const replay = commentRequests.some((request) => request.requestId === input.requestId)
      commentRequests.push(input)
      if (!replay) {
        finding.expectedVersion++
        finding.comments = [{ id: 'comment-1', actorId: 'local', createdAt: '2026-10-17T10:00:00.000Z', text: input.text, findingVersion: finding.expectedVersion }]
        finding.history = [{ id: 'history-1', actorId: 'local', createdAt: '2026-10-17T10:00:00.000Z', action: 'commented', reason: null, fromStatus: 'draft', toStatus: 'draft', version: finding.expectedVersion, evidenceRefs: [] }]
      }
      if (loseCommentAck) { loseCommentAck = false; return new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Acknowledgement lost after commit.' } }), { status: 503 }) }
      return new Response(JSON.stringify(finding), { status: 200 })
    }
    if (path.endsWith('/artifacts/captures') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as { requestId: string; filename: string; mediaType: string }
      const capture = { id: 'cap-1', engagementId: 'eng-1', filename: input.filename, mediaType: input.mediaType, sizeBytes: 2, digest: CAPTURE_SHA256, producer: 'web-user:local', classification: 'unclassified', classificationVersion: 1, uploadedBy: 'local', classifiedBy: null, classificationReason: null, classifiedAt: null, createdAt: '2026-10-14T09:30:00.000Z', canReadOriginal: false, canClassify: true }
      retainedCaptures = [capture]
      return new Response(JSON.stringify(capture), { status: 200 })
    }
    if (path.endsWith('/artifacts/captures/cap-1/classification') && init?.method === 'PATCH') {
      const input = JSON.parse(String(init.body)) as { classification: 'standard' | 'sensitive'; expectedVersion: number; reason: string }
      const capture = { ...retainedCaptures[0], classification: input.classification, classificationVersion: input.expectedVersion + 1, classifiedBy: 'local', classificationReason: input.reason, classifiedAt: '2026-10-14T09:31:00.000Z', canReadOriginal: input.classification === 'standard', canClassify: true }
      retainedCaptures = [capture]
      return new Response(JSON.stringify(capture), { status: 200 })
    }
    if (path.endsWith('/artifacts/captures')) return new Response(JSON.stringify({ engagementId: 'eng-1', captures: retainedCaptures, source: 'db' }), { status: 200 })
    if (path.endsWith('/curated-findings/CF-1/evidence') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as { captureId: string }
      const list = routes['/engagements/eng-1/curated-findings'] as { findings: Record<string, unknown>[] }
      const finding = list.findings.find((item) => item.id === 'CF-1')!
      const link = { id: 'link-1', engagementId: 'eng-1', captureId: input.captureId, kind: 'artifact', artifactPath: 'findings/capture-cap-1.txt', digest: CAPTURE_SHA256, producer: 'web-user:local', createdAt: '2026-10-14T09:32:00.000Z' }
      finding.evidence = [link]
      finding.expectedVersion = Number(finding.expectedVersion) + 1
      return new Response(JSON.stringify(link), { status: 200 })
    }
    if (path.endsWith('/artifacts/captures/cap-1/content')) return new Response(new Uint8Array([0x41, 0x42]), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''capture.txt", 'X-Content-SHA256': CAPTURE_SHA256, 'X-Content-Length': '2' } })
    if (path.endsWith('/curated-findings/import') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as { producerRef: string }
      const imported = { ...curated('CF-003', 'Producer claim', 'draft'), sourceType: 'imported', producerRef: input.producerRef }
      const current = routes['/engagements/eng-1/curated-findings'] as { findings: unknown[] }
      current.findings.push(imported)
      return new Response(JSON.stringify(imported), { status: 201 })
    }
    const body = routes[path]
    return body === undefined ? new Response('[]', { status: 200 }) : new Response(JSON.stringify(body), { status: 200 })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('warns that the producer projection is incomplete when the workspace skipped sources', async () => {
  const producerRoute = routes['/engagements/eng-1/findings'] as { truncated: boolean }
  producerRoute.truncated = true
  try {
    render(<App />)
    await screen.findByText('List truncated', {}, { timeout: 10000 })
  } finally {
    producerRoute.truncated = false
  }
})

it('lists curated records and producer claims in the shared real-mode findings screen', async () => {
  render(<App />)
  await screen.findByText('Admin panel exposed', {}, { timeout: 10000 })
  expect(screen.getByText('Session fixation')).toBeTruthy()
  expect(screen.getByText('Producer claim')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /AI Suggestions/ })).toBeTruthy()
  expect(screen.queryByText('AI suggestions are not in the curated workflow yet')).toBeNull()
})

it('imports a producer claim as a draft and opens the server-issued curated finding ID', async () => {
  const { useSessionStore } = await import('../state/session')
  render(<App />)
  await screen.findByText('Producer claim')
  fireEvent.click(screen.getByRole('tab', { name: /AI Suggestions/ }))
  const verify = await screen.findByRole('button', { name: 'Verify & create finding' })
  expect(verify).toBeEnabled()
  const dismiss = screen.getByRole('button', { name: 'Dismiss' })
  expect(dismiss).toBeEnabled()
  fireEvent.click(dismiss)
  const dismissal = useSessionStore.getState().confirmState
  await act(async () => { await dismissal?.onConfirm('Already imported in another ticket.') })
  await waitFor(() => expect(suggestionDispositions[0]).toMatchObject({ dismissed: true, version: 1 }))
  const showDismissed = await screen.findByLabelText(/Show dismissed suggestions/)
  fireEvent.click(showDismissed)
  await screen.findByRole('button', { name: 'Restore' })
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(suggestionDispositions[0]).toMatchObject({ dismissed: false, version: 2 }))
  useSessionStore.getState().closeConfirm()
  fireEvent.click(screen.getByRole('button', { name: 'Verify & create finding' }))
  const confirmation = useSessionStore.getState().confirmState
  expect(confirmation?.title).toContain('as a draft')
  expect(screen.getByText('The parser supplied the severity default; verify the source before keeping it.')).toBeTruthy()
  await act(async () => { await confirmation?.onConfirm('') })
  await waitFor(() => expect(window.location.hash).toContain('CF-003'))
  await screen.findByRole('heading', { name: 'Producer claim' })
  await screen.findByText('Imported producer lineage')
  expect(screen.getAllByText('findings/FIND-001.md').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
})

it('uploads, classifies and links retained capture bytes through the shared Findings evidence tab', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/finding/CF-1?tab=evidence')
  render(<App />)
  await screen.findByRole('heading', { name: 'Admin panel exposed' })
  fireEvent.click(screen.getAllByRole('button', { name: /Upload evidence/ })[0]!)
  const file = new File([new Uint8Array([0x41, 0x42])], 'capture.txt', { type: 'text/plain' })
  fireEvent.change(screen.getByLabelText(/Capture file/), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Retain unclassified capture' }))
  expect(await screen.findByText(/retained as unclassified/i)).toBeTruthy()
  expect(apiCalls).toContain('GET /engagements/eng-1/artifacts/captures')

  fireEvent.click(screen.getByRole('button', { name: 'Link Evidence' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Classify' }))
  await screen.findByRole('heading', { name: 'Classify retained capture' })
  fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'standard' } })
  fireEvent.change(screen.getByLabelText('Classification reason'), { target: { value: 'Approved standard lab capture.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save classification' }))
  await screen.findByText(/classified standard/i)

  fireEvent.click(screen.getByRole('button', { name: 'Link Evidence' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Link' }))
  await screen.findByText('Linked cap-1 to CF-1.')
  expect((routes['/engagements/eng-1/curated-findings'] as { findings: Array<{ evidence: unknown[] }> }).findings[0]!.evidence).toHaveLength(1)
  fireEvent.click(await screen.findByText('link-1'))
  fireEvent.click(await screen.findByRole('button', { name: 'Preview original' }))
  expect(await screen.findByText('AB')).toBeTruthy()
  expect(screen.getByText(/Capture integrity verified/)).toBeTruthy()
})

it('opens the create form with managed reference choices enabled', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/finding-new')
  render(<App />)
  const asset = await screen.findByLabelText(/Affected asset/)
  expect(asset).toBeEnabled()
  expect(await screen.findByRole('option', { name: 'web-01 (asset-1)' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Finding' })).toBeTruthy())
})

it('reconciles a lost comment acknowledgement through the shared real-mode detail and preserves one record on refresh', async () => {
  window.history.replaceState(null, '', '/?dataMode=real#/finding/CF-1')
  loseCommentAck = true
  const mounted = render(<App />)
  await screen.findByRole('heading', { name: 'Admin panel exposed' })
  const composer = screen.getByLabelText('Comment')
  fireEvent.change(composer, { target: { value: 'Evidence supports the recorded impact.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
  await screen.findByText('Acknowledgement lost after commit.')
  expect(composer).toHaveValue('Evidence supports the recorded impact.')
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
  await screen.findByText('Comment posted.')
  expect(commentRequests).toHaveLength(2)
  expect(commentRequests[0]!.requestId).toBe(commentRequests[1]!.requestId)
  expect(commentRequests[0]!.expectedVersion).toBe(1)
  expect(composer).toHaveValue('')
  mounted.unmount()
  render(<App />)
  await screen.findByText('Evidence supports the recorded impact.')
  expect(await screen.findByText('Comment added')).toBeInTheDocument()
  expect((routes['/engagements/eng-1/curated-findings'] as { findings: CuratedFindingView[] }).findings[0]!.comments).toHaveLength(1)
})
