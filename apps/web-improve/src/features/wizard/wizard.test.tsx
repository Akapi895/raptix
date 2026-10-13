/**
 * Ticket 17: the project wizard shell — five steps with stepper state,
 * information/objectives steps validated through React Hook Form + the
 * shared Zod schema (invalid data cannot advance, errors render inline),
 * back/forward retaining the same draft across migrated and compatibility
 * steps, the dirty/unsaved-changes guard on navigation, and the compat
 * creation flow still committing through the single legacy store action.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StoreProvider, useStore, type Store } from '../../store'
import { ProjectNew } from '../../screens/b-wizard'

afterEach(cleanup)

function Probe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}

function mountWizard() {
  let store!: Store
  const view = render(
    <StoreProvider>
      <Probe ready={(s) => { store = s }} />
      <ProjectNew />
    </StoreProvider>,
  )
  return { store: () => store, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

const fillInfo = () => {
  fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Wizard Smoke Q4' } })
  fireEvent.change(screen.getByLabelText(/Project Code/), { target: { value: 'RT-2026-021' } })
  fireEvent.change(screen.getByLabelText(/^Client/), { target: { value: 'Example Corp A (Demo)' } })
}

const fillObjectives = () => {
  fireEvent.change(screen.getByLabelText(/Main Objective/), { target: { value: 'Assess SOC detection and response against an insider-threat scenario.' } })
  fireEvent.change(screen.getByLabelText('Objective 1'), { target: { value: 'Reach the lab domain admin' } })
  fireEvent.change(screen.getByLabelText('Success criterion 1'), { target: { value: 'A detection alert exists for the escalation path' } })
}

const stepper = () => within(screen.getByRole('list', { name: 'Project creation steps' }))

describe('wizard shell', () => {
  it('renders five steps with stepper state; visited steps become navigable', async () => {
    mountWizard()
    const steps = stepper().getAllByRole('button')
    expect(steps).toHaveLength(5)
    for (const name of ['Basic Details', 'Objectives', 'Scope', 'ROE & Approvals', 'Review & Create']) {
      expect(stepper().getByText(name)).toBeInTheDocument()
    }
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(steps[1]).toBeDisabled()
    expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()

    fillInfo()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Main Objective/)).toBeInTheDocument()
    expect(stepper().getAllByRole('button')[1]).toHaveAttribute('aria-current', 'step')
    expect(stepper().getAllByRole('button')[0]).toBeEnabled()

    fireEvent.click(stepper().getAllByRole('button')[0])
    expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()
    expect(stepper().getAllByRole('button')[0]).toHaveAttribute('aria-current', 'step')
  })
})

describe('migrated step validation (ticket 17)', () => {
  it('step 1 blocks an invalid advance with inline errors', async () => {
    mountWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Enter a project name.')).toBeInTheDocument()
    expect(screen.getByText('Select or enter a client / organization.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Main Objective/)).not.toBeInTheDocument()

    fillInfo()
    fireEvent.change(screen.getByLabelText(/Project Code/), { target: { value: 'wizard-q4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Code must look like RT-2026-016.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Project Code/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Project Code/), { target: { value: 'RT-2026-014' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Code RT-2026-014 already exists/)).toBeInTheDocument()
  })

  it('step 2 validates the main objective and requires a specific objective', async () => {
    mountWizard()
    fillInfo()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Main Objective/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Enter the main objective of the project.')).toBeInTheDocument()
    expect(screen.getByText('Add at least one specific objective.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Main Objective/), { target: { value: 'Assess SOC detection and response' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Add at least one specific objective.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Scope Description/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Objective 1'), { target: { value: 'Reach the lab domain admin' } })
    expect(screen.getByText('Incomplete objective: both the objective and its success criterion are needed.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Scope Description/)).toBeInTheDocument()
  })

  it('back/forward retains the same draft and completion state across migrated and compat steps', async () => {
    mountWizard()
    fillInfo()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Main Objective/)
    fillObjectives()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Scope Description/)
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment, restricted zone excluded.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Main Objective/)).toHaveValue('Assess SOC detection and response against an insider-threat scenario.')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Project Name/)).toHaveValue('Wizard Smoke Q4')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Main Objective/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Scope Description/)).toHaveValue('Lab environment, restricted zone excluded.')
  })
})

describe('dirty guard (story 5 foundation)', () => {
  it('a dirty draft warns on navigation and can be discarded', async () => {
    const h = mountWizard()
    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Dirty Draft' } })
    expect(screen.getByText('Draft: not saved')).toBeInTheDocument()
    await waitFor(() => expect(h.store().dirty).toBe(true))

    h.run(() => { h.store().go('projects') })
    expect(h.store().unsaved).not.toBeNull()
    expect(h.store().unsaved?.save).toBeTypeOf('function')
    expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()

    h.run(() => { h.store().unsaved!.next() })
    await waitFor(() => expect(h.store().route.page).toBe('projects'))
    expect(h.store().dirty).toBe(false)
    expect(h.store().db.projects.length).toBe(6)
  })

  it('the guard Save Draft callback creates the draft through the legacy action and leaves', async () => {
    const h = mountWizard()
    fillInfo()
    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Guard Saved Draft' } })
    await waitFor(() => expect(h.store().dirty).toBe(true))

    h.run(() => { h.store().go('projects') })
    h.run(() => { h.store().unsaved!.save!() })
    await waitFor(() => expect(h.store().db.projects.length).toBe(7))
    expect(h.store().db.projects[0].status).toBe('draft')
    await waitFor(() => expect(h.store().route.page).toBe('project'))
    expect(h.store().pid).toBe('RT-2026-021')
  })
})

describe('compat creation flow (single legacy path)', () => {
  it('the five-step flow reaches review, blocks an invalid submit and creates a draft as today', async () => {
    const h = mountWizard()
    fillInfo()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Main Objective/)
    fillObjectives()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Scope Description/)
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment, restricted zone excluded.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Validation')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Submit for Approval' })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/Submit is blocked by:/)).toBeInTheDocument()
    expect(screen.getAllByText('At least one in-scope asset').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Emergency contact provided').length).toBeGreaterThan(0)
    expect(h.store().db.projects.length).toBe(6)

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }))
    await waitFor(() => expect(h.store().db.projects.length).toBe(7))
    const p = h.store().db.projects[0]
    expect(p.id).toBe('RT-2026-021')
    expect(p.status).toBe('draft')
    expect(p.roeStatus).toBe('draft')
    expect(p.start).toBe('Oct 20, 2026')
    expect(p.desc).toContain('Main objective: Assess SOC detection and response against an insider-threat scenario.')
    expect(p.objectives[0].text).toBe('Reach the lab domain admin')
    await waitFor(() => expect(h.store().route.page).toBe('project'))
    expect(h.store().pid).toBe('RT-2026-021')
    expect(h.store().toasts.some((t) => t.text === 'Saved draft RT-2026-021 with draft ROE-021-v1')).toBe(true)
  })

  it('Save Draft on an invalid step 1 refuses with a warning and stays on the wizard', async () => {
    const h = mountWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(await screen.findByText('Enter a project name.')).toBeInTheDocument()
    expect(h.store().db.projects.length).toBe(6)
    expect(h.store().toasts.some((t) => t.text === 'Complete a valid Step 1 before saving a draft.')).toBe(true)
    expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()
  })
})
