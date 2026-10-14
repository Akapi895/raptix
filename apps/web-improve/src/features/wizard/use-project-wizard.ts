/**
 * Project wizard shell state (tickets 17–19, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * One React Hook Form instance owns the whole draft: back/forward retains
 * values and completion state across all input steps, `formState.isDirty`
 * drives the shared unsaved-changes guard (`useDirty`), and every step
 * transition gates on that step's fields through the shared Zod schema (the
 * review step gates through the submit issues). Save-draft/create run the
 * ticket-19 transaction handler directly (the same handler the legacy store
 * action delegates to) with the same request context and refusal behavior —
 * refusals surface as submit errors with the draft kept — and a committed
 * creation writes the active project, so the end-to-end creation flow and
 * its audit trail stay the one canonical path.
 */
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useDirty } from '../../state/session'
import { useServices } from '../../state/services'
import { useDb, useMe } from '../../state/console'
import { useProjectStore, useToastStore } from '../../state/stores'
import { go } from '../../router/navigate'
import { createProjectTransaction } from './service'
import {
  INFO_FIELDS, WIZARD_STEPS, defaultWizardDraft, makeWizardSchema, nextId,
  reviewIssues, toLegacyProjectDraft, validateWizardStep, type WizardDraft,
} from './draft'

export function useProjectWizard() {
  const services = useServices()
  const db = useDb()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const canCreate = me.role === 'admin' || me.role === 'manager'
  /* Frozen at mount: the wizard cannot create projects mid-flow, so the
   * duplicate-code check and the auto-suggested code stay stable for the
   * whole draft. */
  const [ids] = useState(() => db.projects.map((p) => p.id))
  const [defaults] = useState(() => defaultWizardDraft(ids, me.name))
  const [schema] = useState(() => makeWizardSchema(ids))

  const form = useForm<WizardDraft>({ resolver: zodResolver(schema), defaultValues: defaults, mode: 'onTouched' })
  const w = form.watch()
  const { formState } = form

  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  /* Attempted steps reveal their error set (stepper badge + compat bodies),
   * matching the legacy wizard's show-on-advance behavior. */
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  /* Ungated live errors per step — the review panel and submit gate read
   * these regardless of which steps were visited. */
  const live = WIZARD_STEPS.map((_def, i) => validateWizardStep(i, w, ids))
  const shown = (i: number) => (attempted[i] ? live[i] : {})
  const isDirty = formState.isDirty

  const issues = reviewIssues(w, live)
  const blocking = issues.filter((i) => !i.ok && i.level !== 'review')

  const advance = (n: number) => {
    setStep(n)
    setMaxStep((m) => Math.max(m, n))
    document.querySelector('main')?.scrollTo?.(0, 0)
  }

  const next = async () => {
    setAttempted((s) => ({ ...s, [step]: true }))
    const def = WIZARD_STEPS[step]
    if (def.fields && !(await form.trigger([...def.fields]))) return
    if (step < WIZARD_STEPS.length - 1) advance(step + 1)
  }
  const back = () => setStep((s) => Math.max(0, s - 1))
  const jump = (i: number) => {
    if (i > maxStep || i === step) return
    setAttempted((s) => ({ ...s, [step]: true }))
    setStep(i)
    document.querySelector('main')?.scrollTo?.(0, 0)
  }

  const create = async (submit: boolean) => {
    if (saving || done) return
    if (!navigator.onLine) { setErr('Network connection lost. Your data is kept in the form. Try again when you are back online.'); return }
    setAttempted((s) => ({ ...s, 0: true }))
    if (!(await form.trigger([...INFO_FIELDS]))) {
      setStep(0)
      setErr('Basic details are not valid yet. Check the highlighted fields.')
      return
    }
    if (submit && blocking.length) { setErr('Not ready to submit for approval: ' + blocking.map((b) => b.label).join('; ')); return }
    setErr(''); setSaving(true)
    /* The single canonical creation path: the ticket-19 transaction handler
     * refuses unauthorized/invalid submissions with every entity unchanged
     * ('' here). The typed draft stays in the form, so a refused submit can
     * be fixed and retried; a committed creation writes the active project
     * (the raw pid write the store action performed). */
    const res = createProjectTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, toLegacyProjectDraft(w), submit)
    if (!res.ok) {
      setSaving(false)
      setErr('The submission was rejected. Your draft is kept in the form — check the validation panel, then try again.')
      return
    }
    useProjectStore.getState().setPid(res.data.id)
    const id = res.data.id
    setDone(true)
    toast(submit ? `Created ${id} and submitted for approval` : `Saved draft ${id} with draft ROE-${id.slice(-3)}-v1`)
    setTimeout(() => go('project', { id, tab: submit ? 'team' : 'overview' }), 80)
  }
  const saveDraft = () => {
    if (Object.keys(live[0]).length) {
      setAttempted((s) => ({ ...s, 0: true }))
      setStep(0)
      void form.trigger([...INFO_FIELDS])
      toast('Complete a valid Step 1 before saving a draft.', 'warn')
      return
    }
    void create(false)
  }

  /* Story-5 foundation: dirty drafts warn on any navigation (in-app `go` and
   * the router blocker both route through this guard) and can save or discard. */
  useDirty(isDirty && !done, saveDraft)

  /* Draft accessors for the compat step 5 (and value-list inputs on steps
   * 3–4): `set` mirrors the legacy key/value writer, `update` the legacy
   * functional setState. */
  const set = <K extends keyof WizardDraft>(k: K, v: WizardDraft[K]) => form.setValue(k, v as never, { shouldDirty: true })
  const update = (fn: (prev: WizardDraft) => WizardDraft) => {
    const nextDraft = fn(form.getValues())
    ;(Object.keys(nextDraft) as (keyof WizardDraft)[]).forEach((k) => form.setValue(k, nextDraft[k] as never, { shouldDirty: true }))
  }

  return {
    form, w, ids, step, maxStep, attempted, live, shown, isDirty, issues, blocking,
    canCreate, saving, done, err, setErr, next, back, jump, create, saveDraft, set, update,
    suggestId: (type: string) => nextId(ids, type),
  }
}

export type ProjectWizard = ReturnType<typeof useProjectWizard>
