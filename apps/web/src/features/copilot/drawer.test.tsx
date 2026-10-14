/**
 * Ticket 60: context-aware copilot drawer on typed services — rendered
 * through the real route host so the `copilotDrawer` shell slot composition
 * (src/router/host.tsx) is exercised, not a stub.
 *
 * Covered here: slot composition and the page/project context chips; scoped
 * conversation reads (only the active project's accessible thread; a persona
 * without access gets a refusal, never the previous engagement content);
 * proposal-only surface — no execution/approval control exists anywhere in
 * the drawer and the propose flow lands a `proposed` plan with no operation;
 * quick prompts through the bridged chat action; conversation auto-create
 * through the typed handler; the bridge proof (a typed-service chat mutation
 * reaches the open drawer without a reload); drawer close on project switch;
 * the all-projects guard.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHashRouter, RouterProvider } from 'react-router'
import { mountServices } from '../../test/helpers'
import { selectProject } from '../../router/navigate'
import { setActiveRouter } from '../../router/active'
import { RouteHost } from '../../router/host'
import type { ActorRef, RequestContext } from '../../domain/service'

afterEach(() => {
  cleanup()
  setActiveRouter(null)
  window.location.hash = ''
})

function mountDrawer(me = 'Alex Morgan', pid?: string) {
  window.location.hash = '#/operations'
  const router = createHashRouter([
    { path: '*', element: <RouteHost />, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  const h = mountServices(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
  h.as(me)
  if (pid) act(() => { selectProject(pid) })
  return {
    ...h,
    /** Runs a mutation inside act() so the store projection and Query refetch flush. */
    run: <T,>(fn: () => T): T => { let out!: T; act(() => { out = fn() }); return out },
  }
}

const openDrawer = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }))
  return await screen.findByRole('dialog', { name: 'Ask AI' })
}

const admin = (): ActorRef => ({ id: 'Alex Morgan', role: 'admin' })

describe('copilot drawer via the shell slot (ticket 60)', () => {
  it('opens through the copilotDrawer slot with the page/project context', async () => {
    mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    expect(drawer).toHaveAttribute('data-testid', 'copilot-drawer')
    expect(within(drawer).getByText('Context: Operations')).toBeInTheDocument()
    expect(within(drawer).getByText('RT-2026-015')).toBeInTheDocument()
    // The migrated drawer's context header, not a duplicated store state.
    expect(within(drawer).getByText(/Context follows the page you opened it from/)).toBeInTheDocument()
  })

  it('reads only the current project’s accessible conversation through the scoped typed read', async () => {
    mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    expect(await within(drawer).findByText('Draft a plan to validate the cloud lab configuration.')).toBeInTheDocument()
    // The seeded proposal renders as a plan card in the drawer thread.
    expect(await within(drawer).findByText('Waiting for approval from Pat Kim.')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'View plan' })).toBeInTheDocument()
    // No other project's conversation content is present.
    expect(within(drawer).queryByText('Plan an internal discovery run for the in-scope Windows and Linux lab hosts.')).not.toBeInTheDocument()
  })

  it('a persona without access sees a refusal, never the previous engagement content', async () => {
    const h = mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    await within(drawer).findByText('Draft a plan to validate the cloud lab configuration.')
    h.as('Riley Brooks') // analyst — not a member of RT-2026-015
    const refusal = await within(drawer).findByTestId('copilot-refusal')
    expect(refusal.textContent).toContain('not available for your account')
    expect(within(drawer).queryByText('Draft a plan to validate the cloud lab configuration.')).not.toBeInTheDocument()
  })

  it('the surface is proposal-only: no execution or approval control exists, and the propose flow lands a proposal', async () => {
    const h = mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    await within(drawer).findByText('Draft a plan to validate the cloud lab configuration.')
    // Invariant 5 asserted on the rendered surface: no execution/approval path.
    for (const name of [/execute/i, /start/i, /approve/i, /allow/i]) {
      expect(within(drawer).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    // The propose action asks for confirmation and stays a proposal.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Propose Next Step' }))
    const modal = await screen.findByRole('dialog', { name: /propose next step/i })
    expect(within(modal).getByText(/Nothing is executed and the proposal needs reviewer approval/)).toBeInTheDocument()
    fireEvent.click(within(modal).getByRole('button', { name: 'Request proposal' }))
    expect(await screen.findByText('Proposal requested. It stays a proposal until a reviewer approves it.')).toBeInTheDocument()
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) })
    const d = h.db()
    const fromDrawer = d.plans.filter((p) => p.conversationId === 'CV-015-01' && p.id !== 'PL-022')
    expect(fromDrawer).toHaveLength(1)
    expect(fromDrawer[0]!.status).toBe('proposed')
    // Chat-created proposals are unbound: no operation exists for them.
    expect(d.operations.some((o) => o.planId === fromDrawer[0]!.id)).toBe(false)
    expect(await within(drawer).findByText(/This is a proposal only; nothing has run\./)).toBeInTheDocument()
  })

  it('quick prompts send through the bridged chat action and render the reply', async () => {
    mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    const chip = await within(drawer).findByRole('button', { name: 'Explain recent operation results' })
    fireEvent.click(chip)
    expect(await within(drawer).findByText('Explain recent operation results')).toBeInTheDocument()
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) })
    // The assistant turn arrives through the ChangeSet-driven refetch.
    expect(within(drawer).getByText(/I can answer questions about RT-2026-015/)).toBeInTheDocument()
  })

  it('a typed-service chat mutation reaches the open drawer without a reload (bridge proof)', async () => {
    const h = mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    await within(drawer).findByText('Draft a plan to validate the cloud lab configuration.')
    const ctx: RequestContext = { actor: admin(), projectId: 'all', corr: 't' }
    h.run(() => h.svc().chat(admin(), 'all').send(ctx, 'CV-015-01', 'Hello from the typed service.'))
    // The committed ChangeSet invalidates the conversation query; the drawer re-renders live.
    expect(await within(drawer).findByText('Hello from the typed service.')).toBeInTheDocument()
  })

  it('auto-creates the project conversation through the typed handler when none exists', async () => {
    const h = mountDrawer('Sam Patel', 'PT-2026-006')
    const drawer = await openDrawer()
    expect(await within(drawer).findByText(/Ask about Operations/)).toBeInTheDocument()
    expect(h.db().conversations.find((c) => c.projectId === 'PT-2026-006')).toBeDefined()
  })

  it('switching the active project closes the drawer instead of exposing other project content', async () => {
    const h = mountDrawer('Sam Patel', 'RT-2026-015')
    const drawer = await openDrawer()
    await within(drawer).findByText('Draft a plan to validate the cloud lab configuration.')
    act(() => { selectProject('RT-2026-014') })
    await waitFor(() => expect(screen.queryByTestId('copilot-drawer')).not.toBeInTheDocument())
    h.unmount()
  })

  it('the all-projects scope shows the select-project guard, never aggregate engagement data', async () => {
    mountDrawer('Sam Patel')
    const drawer = await openDrawer()
    expect(await within(drawer).findByText('Select a project to continue')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })
})
