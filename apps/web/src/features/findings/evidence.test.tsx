/**
 * Ticket 33: standalone evidence inspector on typed reads — scoped evidence
 * list with opaque references and role-sensitive masking (a search can never
 * match a withheld name), missing/cross-project evidence handled without
 * content leaks or existence leaks, producer lineage resolved from real
 * record links, simulated capture integrity that describes the retained
 * capture and never a finding's truth, both route aliases rendering the same
 * inspector, and ChangeSet-driven refetch after an evidence attach (ticket
 * 32's handler).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ComponentType } from 'react'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { useProjectStore } from '../../state/stores'
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/e'
import { seed } from '../../data'
import { getEvidence, listEvidence } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/** Mounts the providers, optionally rendering the evidence route matching the current hash. */
function mountEvidence(me = 'Alex Morgan') {
  const screenFor = (): ComponentType =>
    window.location.hash.startsWith('#/evidence-inspector/') ? routes['evidence-inspector'] : routes.evidence
  const h = mountServices(null, me)
  return { ...h, show: () => {
    const Screen = screenFor()
    h.show(<Screen />)
  } }
}

describe('evidence list + inspector (ticket 33)', () => {
  it('list renders opaque references and masks sensitive names for a role without viewSensitive', async () => {
    window.location.hash = '#/evidence'
    const h = mountEvidence('Casey Nguyen (Client)') // viewer — member of RT-2026-014, no viewSensitive
    h.show()
    await waitFor(() => expect(screen.getByText('EV-014-01')).toBeInTheDocument())
    expect(screen.getByText('EV-014-02')).toBeInTheDocument() // the opaque reference stays visible
    expect(screen.getByText('Sensitive file — redacted')).toBeInTheDocument()
    expect(screen.queryByText('evidence-027.png')).not.toBeInTheDocument()
    expect(screen.queryByText('EV-301')).not.toBeInTheDocument() // RT-2026-015 — not a member
    h.unmount()
  })

  it('inspector masks sensitive content and download for a low-privilege role; integrity copy follows the vocabulary', async () => {
    window.location.hash = '#/evidence/EV-014-02'
    const h = mountEvidence('Casey Nguyen (Client)')
    h.show()
    await waitFor(() => expect(screen.getByText('Content masked by default')).toBeInTheDocument())
    expect(screen.getAllByText('EV-014-02').length).toBeGreaterThan(0) // reference visible, name withheld
    expect(screen.queryByText('evidence-027.png')).not.toBeInTheDocument()
    const download = screen.getByRole('button', { name: 'Download' })
    expect(download).toBeDisabled()
    expect(download.getAttribute('title')).toContain('cannot download')
    const text = document.body.textContent || ''
    expect(text).toMatch(/Integrity verified \(simulated\)/)
    expect(text).toMatch(/not proof that any finding is true/)
    expect(text).not.toMatch(/proven exploitability|proof of exploitability/i)
    h.unmount()
  })

  it('shows not-found for missing or out-of-scope evidence without leaking existence', async () => {
    window.location.hash = '#/evidence/EV-999'
    const h = mountEvidence('Taylor Chen')
    h.show()
    await waitFor(() => expect(screen.getByText('Evidence not found')).toBeInTheDocument())
    expect(screen.getByText('ID EV-999 does not exist or is not available for your account.')).toBeInTheDocument()
    h.unmount()

    window.location.hash = '#/evidence/EV-301' // RT-2026-015 — Riley is not a member
    const p = mountEvidence('Riley Brooks')
    p.show()
    await waitFor(() => expect(screen.getByText('Evidence not found')).toBeInTheDocument())
    expect(screen.queryByText('iam-review.json')).not.toBeInTheDocument()
    expect(screen.queryByText('A service role is granted broader permissions than policy allows.')).not.toBeInTheDocument()
    p.unmount()
  })

  it('refuses cross-project evidence without content and switches only after an explicit, access-checked prompt', async () => {
    window.location.hash = '#/evidence/EV-014-02' // belongs to RT-2026-014
    const h = mountEvidence('Sam Patel') // manager — reaches both projects
    h.show()
    await waitFor(() => expect(screen.getByText('evidence-027.png')).toBeInTheDocument())
    // Active project changes while the inspector stays on the 014 capture (for example from another tab).
    // selectProject would navigate to the project page, which is a different state from the one under test.
    h.run(() => useProjectStore.getState().setPid('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('Evidence EV-014-02 belongs to another project')).toBeInTheDocument())
    expect(screen.getByText(/content from RT-2026-014 is not shown in this context/)).toBeInTheDocument()
    expect(screen.queryByText('evidence-027.png')).not.toBeInTheDocument()
    expect(screen.queryByText('Content masked by default')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to RT-2026-014' }))
    await waitFor(() => expect(useProjectStore.getState().pid).toBe('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('evidence-027.png')).toBeInTheDocument(), { timeout: 3000 })
    h.unmount()
  })

  it('both route aliases render the same typed inspector with producer links', async () => {
    window.location.hash = '#/evidence-inspector/EV-014-01'
    const h = mountEvidence('Taylor Chen')
    h.show()
    await waitFor(() => expect(screen.getByText('accounts-output.txt')).toBeInTheDocument())
    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('AG-008 · LAB-LNX-01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SS-042' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OP-014' })).toBeInTheDocument()
    h.unmount()

    window.location.hash = '#/evidence/EV-014-01'
    const p = mountEvidence('Taylor Chen')
    p.show()
    await waitFor(() => expect(screen.getByText('accounts-output.txt')).toBeInTheDocument())
    expect(screen.getByText('Metadata')).toBeInTheDocument()
    p.unmount()
  })

  it('an evidence attach (ticket 32 handler) refetches the inspector through its ChangeSet', async () => {
    window.location.hash = '#/evidence/EV-014-01'
    const h = mountEvidence('Taylor Chen')
    h.show()
    await waitFor(() => expect(screen.getByText('Not linked yet')).toBeInTheDocument())
    h.run(() => {
      const actor = { id: 'Taylor Chen', role: 'operator' as const }
      void h.svc().findings(actor, 'RT-2026-014')
        .attachEvidence({ actor, projectId: 'RT-2026-014', corr: 'evidence-attach-test' }, 'FD-011', 'EV-014-01')
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /FD-011/ })).toBeInTheDocument(), { timeout: 3000 })
    h.unmount()
  })

  it('the list surfaces a non-member specific-project read as an error, not content', async () => {
    window.location.hash = '#/evidence'
    const h = mountEvidence('Riley Brooks')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-015')) // Riley is not a member; the list stays in place
    await waitFor(() => expect(screen.getByText('Could not load evidence')).toBeInTheDocument())
    expect(screen.getByText('Evidence for this project is not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('iam-review.json')).not.toBeInTheDocument()
    h.unmount()
  })
})

describe('evidence read handlers (ticket 33)', () => {
  const taylor = { id: 'Taylor Chen', role: 'operator' as const }
  const casey = { id: 'Casey Nguyen (Client)', role: 'viewer' as const }
  const riley = { id: 'Riley Brooks', role: 'analyst' as const }
  const allCtx: RequestContext = { actor: taylor, projectId: 'all', corr: 't' }

  it('lists scoped evidence with opaque refs and masks sensitive names without viewSensitive', () => {
    const masked = listEvidence(seed(), { actor: casey, projectId: 'all', corr: 't' })
    const open = listEvidence(seed(), allCtx)
    expect(masked.ok && open.ok).toBe(true)
    if (masked.ok && open.ok) {
      expect(masked.data.items.find((e) => e.ref === 'EV-014-02')).toMatchObject({ ref: 'EV-014-02', masked: true, sensitive: true })
      expect(masked.data.items.find((e) => e.ref === 'EV-014-02')?.name).toBeUndefined()
      expect(open.data.items.find((e) => e.ref === 'EV-014-02')).toMatchObject({ masked: false, name: 'evidence-027.png' })
      expect(masked.data.items.some((e) => e.ref === 'EV-301')).toBe(false) // aggregate folds accessible projects only
      expect(open.data.items.map((e) => e.ref)).toContain('EV-301')
      expect(open.data.kinds.length).toBeGreaterThan(0)
    }
  })

  it('a search can never match a withheld name (no leak through the list filter)', () => {
    const viewerHit = listEvidence(seed(), { actor: casey, projectId: 'RT-2026-014', corr: 't' }, { q: 'evidence-027' })
    const operatorHit = listEvidence(seed(), { actor: taylor, projectId: 'RT-2026-014', corr: 't' }, { q: 'evidence-027' })
    expect(viewerHit.ok && operatorHit.ok).toBe(true)
    if (viewerHit.ok && operatorHit.ok) {
      expect(viewerHit.data.items).toHaveLength(0)
      expect(operatorHit.data.items.map((e) => e.ref)).toEqual(['EV-014-02'])
    }
  })

  it('refuses a non-member specific-project list without leaking existence', () => {
    const res = listEvidence(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('reports missing and out-of-scope evidence as indistinguishable not-found failures', () => {
    const missing = getEvidence(seed(), allCtx, 'EV-999')
    const foreign = getEvidence(seed(), { actor: riley, projectId: 'all', corr: 't' }, 'EV-301')
    expect(missing.ok).toBe(false)
    expect(foreign.ok).toBe(false)
    if (!missing.ok && !foreign.ok) {
      expect(missing.failure.kind).toBe('not-found')
      expect(foreign.failure.kind).toBe('not-found')
      expect(foreign.failure.message).toBe(missing.failure.message.replace('EV-999', 'EV-301'))
      expect(foreign.failure.message).not.toContain('iam-review.json')
    }
  })

  it('refuses a cross-project context with the owning project and no content', () => {
    const res = getEvidence(seed(), { actor: taylor, projectId: 'RT-2026-015', corr: 't' }, 'EV-014-02')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
      expect(res.failure.message).not.toContain('evidence-027.png')
    }
  })

  it('resolves producer lineage from record links and lists the referencing findings', () => {
    const res = getEvidence(seed(), allCtx, 'EV-014-02')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.producer?.operation).toMatchObject({ id: 'OP-014' })
      expect(res.data.producer?.invocation).toMatchObject({ id: 'TL-02', tool: 'account-enumerator', producer: 'AG-007' })
      expect(res.data.producer?.step).toMatchObject({ id: 'S06' })
      expect(res.data.producer?.agent).toMatchObject({ id: 'AG-008', host: 'LAB-LNX-01' })
      expect(res.data.producer?.session).toMatchObject({ id: 'SS-042' })
      expect(res.data.findings).toEqual([{ id: 'FD-011', status: 'confirmed', updated: expect.any(String) }])
      expect(res.data.project).toMatchObject({ id: 'RT-2026-014' })
    }
  })

  it('keeps the capture-integrity vocabulary: a deterministic simulated digest per capture', () => {
    const a = getEvidence(seed(), allCtx, 'EV-014-01')
    const b = getEvidence(seed(), allCtx, 'EV-014-02')
    const again = getEvidence(seed(), allCtx, 'EV-014-01')
    expect(a.ok && b.ok && again.ok).toBe(true)
    if (a.ok && b.ok && again.ok) {
      expect(a.data.integrity.status).toBe('verified')
      expect(a.data.integrity.digest).toBe(again.data.integrity.digest)
      expect(a.data.integrity.digest).not.toBe(b.data.integrity.digest)
    }
  })

  it('gates display independently of the linking screen: analyst is masked-only, operator may unmask, viewer neither', () => {
    const analyst = getEvidence(seed(), { actor: riley, projectId: 'all', corr: 't' }, 'EV-014-02')
    const operator = getEvidence(seed(), { actor: taylor, projectId: 'all', corr: 't' }, 'EV-014-02')
    const viewer = getEvidence(seed(), { actor: casey, projectId: 'all', corr: 't' }, 'EV-014-02')
    expect(analyst.ok && operator.ok && viewer.ok).toBe(true)
    if (analyst.ok && operator.ok && viewer.ok) {
      expect(analyst.data.canViewSensitive).toBe(true)
      expect(analyst.data.canViewOriginal).toBe(false)
      expect(analyst.data.evidence.masked).toBe(false)
      expect(operator.data.canViewOriginal).toBe(true)
      expect(viewer.data.canViewSensitive).toBe(false)
      expect(viewer.data.canViewOriginal).toBe(false)
      expect(viewer.data.evidence.masked).toBe(true)
      expect(viewer.data.evidence.name).toBeUndefined()
    }
  })
})
