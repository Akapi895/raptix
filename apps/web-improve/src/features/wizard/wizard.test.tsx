/**
 * Tickets 17/18: the project wizard shell — five steps with stepper state,
 * information/objectives/scope/ROE steps validated through React Hook Form
 * + the shared Zod schema (invalid data cannot advance, errors render
 * inline, cross-field rules retained), back/forward retaining the same
 * draft, the dirty/unsaved-changes guard on navigation, and the five-step
 * creation flow still committing through the single legacy store action.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StoreProvider, useStore, type Store } from '../../store'
import { ProjectNew } from '../../screens/b-wizard'
import { defaultWizardDraft, validateWizardStep } from './draft'

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

describe('migrated scope/ROE steps (ticket 18)', () => {
  const walkToScope = async () => {
    const h = mountWizard()
    fillInfo()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Main Objective/)
    fillObjectives()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Scope Description/)
    return h
  }
  const addAsset = (name: string, ident: string) => {
    fireEvent.change(screen.getByLabelText('Asset name'), { target: { value: name } })
    fireEvent.change(screen.getByLabelText(/Identifier \(synthetic FQDN/), { target: { value: ident } })
    fireEvent.click(screen.getByRole('button', { name: /Add (Asset|Exclusion)/ }))
  }

  it('the shared schema enforces the legacy scope/ROE rules verbatim', () => {
    const w = { ...defaultWizardDraft(['RT-2026-021'], 'Alex Morgan'), scopeDesc: '', window: '' }
    expect(validateWizardStep(2, w, [])).toEqual({ scopeDesc: 'Describe the testing scope.', window: 'Enter the permitted testing days and hours.' })
    expect(validateWizardStep(3, w, [])).toEqual({})
    expect(validateWizardStep(3, { ...w, approver: '' }, [])).toEqual({ approver: 'Choose a requested reviewer.' })
    expect(validateWizardStep(3, { ...w, approver: 'Alex Morgan' }, [])).toEqual({ approver: 'The reviewer must be different from the owner.' })
    expect(validateWizardStep(3, { ...w, approver: 'Sam Patel' }, [])).toEqual({ approver: 'The requested reviewer must be on the member list.' })
    expect(validateWizardStep(3, { ...w, approver: 'Pat Kim' }, [])).toEqual({})
  })

  it('step 3 blocks an invalid advance with inline errors and validates asset entry', async () => {
    const h = await walkToScope()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Describe the testing scope.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Requested Reviewer/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment, restricted zone excluded.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Requested Reviewer/)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.change(screen.getByLabelText(/Assessment Window/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Enter the permitted testing days and hours.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Requested Reviewer/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Asset' }))
    expect(await screen.findByText('Enter the asset name and identifier (synthetic FQDN / IP).')).toBeInTheDocument()
    addAsset('web-lab-01', 'web-lab-01.lab.local')
    expect(await screen.findByText('web-lab-01')).toBeInTheDocument()
    addAsset('web-lab-01-dup', 'web-lab-01.lab.local')
    expect(screen.getByText('Identifier web-lab-01.lab.local is already in the list.')).toBeInTheDocument()
    expect(h.store().db.projects.length).toBe(6)
  })

  it('step 4 enforces the approver cross-field rules before advancing', async () => {
    mountWizard()
    fillInfo()
    fireEvent.change(screen.getByLabelText(/Primary Owner/), { target: { value: 'Dana Whitfield' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Main Objective/)
    fillObjectives()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Scope Description/)
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Requested Reviewer/)

    fireEvent.change(screen.getByLabelText(/Requested Reviewer/), { target: { value: 'Dana Whitfield' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('The reviewer must be different from the owner.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Requested Reviewer/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Requested Reviewer/), { target: { value: 'Pat Kim' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Validation')).toBeInTheDocument()
  })

  it('the shared-schema cross-field date-order rule still gates the flow', async () => {
    mountWizard()
    fillInfo()
    fireEvent.change(screen.getByLabelText(/End Date/), { target: { value: '2026-10-19' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('End date cannot be before the start date.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Project Name/)).toBeInTheDocument()
  })

  it('asset additions and ROE entries survive back/forward navigation with the dirty guard armed', async () => {
    const h = await walkToScope()
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment, restricted zone excluded.' } })
    addAsset('web-lab-01', 'web-lab-01.lab.local')
    fireEvent.click(screen.getByRole('tab', { name: /Excluded Targets/ }))
    addAsset('restricted-zone', 'rz-01.lab.local')
    expect(screen.getByText('restricted-zone')).toBeInTheDocument()
    expect(screen.getByText('Do not touch. Excluded from operation target selection')).toBeInTheDocument()
    expect(screen.getByText('Draft: not saved')).toBeInTheDocument()
    await waitFor(() => expect(h.store().dirty).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Emergency Contact/)
    fireEvent.change(screen.getByLabelText(/Emergency Contact/), { target: { value: 'Robin Vale — +1 (555) 010-0100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Scope Description/)).toHaveValue('Lab environment, restricted zone excluded.')
    expect(screen.getByLabelText(/Assessment Window/)).toHaveValue('Mon–Fri, 9:00 AM–5:00 PM (UTC+7)')
    fireEvent.click(screen.getByRole('tab', { name: /Allowed Targets/ }))
    expect(screen.getByText('web-lab-01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Excluded Targets/ }))
    expect(screen.getByText('restricted-zone')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText(/Emergency Contact/)).toHaveValue('Robin Vale — +1 (555) 010-0100')
  })

  it('switching persona mid-flow cannot silently retarget the frozen draft', async () => {
    const h = mountWizard()
    fillInfo()
    fireEvent.change(screen.getByLabelText(/Project Code/), { target: { value: 'RT-2026-077' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Main Objective/)
    fillObjectives()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Scope Description/)
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment.' } })

    h.run(() => { h.store().setMe('Jordan Lee') })
    expect(screen.getByLabelText(/Scope Description/)).toHaveValue('Lab environment.')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Main Objective/)).toHaveValue('Assess SOC detection and response against an insider-threat scenario.')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText(/Project Name/)).toHaveValue('Wizard Smoke Q4')
    expect(screen.getByLabelText(/Project Code/)).toHaveValue('RT-2026-077')
    expect(screen.getByLabelText(/Primary Owner/)).toHaveValue('Alex Morgan')
  })

  it('submitting with scope essentials lands the project pending with assets pending until approval', async () => {
    const h = await walkToScope()
    fireEvent.change(screen.getByLabelText(/Scope Description/), { target: { value: 'Lab environment, restricted zone excluded.' } })
    addAsset('web-lab-01', 'web-lab-01.lab.local')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Emergency Contact/)
    fireEvent.change(screen.getByLabelText(/Emergency Contact/), { target: { value: 'Robin Vale — +1 (555) 010-0100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Validation')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Submit for Approval' })
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm the scope/ }))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(h.store().db.projects.length).toBe(7))
    const p = h.store().db.projects[0]
    expect(p.id).toBe('RT-2026-021')
    expect(p.status).toBe('pending')
    expect(p.roeStatus).toBe('pending')
    expect(p.emergency).toBe('Robin Vale — +1 (555) 010-0100')
    const assets = h.store().db.assets.filter((a) => a.projectId === 'RT-2026-021')
    expect(assets).toHaveLength(1)
    expect(assets[0].scope).toBe('pending')

    const apr = h.store().db.approvals.find((a) => a.projectId === 'RT-2026-021' && a.type === 'Project creation')
    expect(apr?.status).toBe('pending')
    h.run(() => { h.store().A.decideApproval(apr!.id, 'approved', 'ok') })
    expect(h.store().db.projects[0].status).toBe('approved')
    expect(h.store().db.assets.find((a) => a.projectId === 'RT-2026-021')!.scope).toBe('in')
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
    /* Steps 3–4 now gate through the async RHF trigger like steps 1–2, so the
     * walk awaits each transition instead of firing Next back-to-back. */
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/Requested Reviewer/)
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
