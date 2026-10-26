/**
 * Real engagement creation (integration ticket 03, decisions D2/D4).
 *
 * Only the fields the engagement contract accepts are rendered and POSTed:
 * workspace slug, display name, target type/value, authorization
 * confirmation and the operator brief. The demo wizard's unsupported steps
 * (objectives, members, ROE document, scheduling) are named as not-yet
 * integrated — creating never persists them under a real label.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, Info } from 'lucide-react'
import { invalidateProjects, projectKeys, useCreateProject, useProjectCacheActor } from '../query'
import { targetTypeOf } from '../target'
import { markPlanningSeed } from '../../aichat/planning-seed'
import { showCreateProject, useCreateProjectDialog } from '../create-dialog-state'
import { go } from '../../../router/navigate'
import { useDirty, useSessionStore } from '../../../state/session'
import { useToastStore } from '../../../state/stores'
import { Banner, Button, Card, CardHeader, Check, Field, Input, Modal, Textarea } from '../../../ui/index'

/** Server slug rule (apps/web/server security/project-policy.ts): lowercase
 *  kebab DNS label, 3-63 chars, starts/ends alphanumeric. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

interface FormState {
  displayName: string
  name: string
  nameTouched: boolean
  targetValue: string
  brief: string
  authorized: boolean
}

const INITIAL: FormState = { displayName: '', name: '', nameTouched: false, targetValue: '', brief: '', authorized: false }

/** The creation form; it is hosted by the "New project" popup and reset whenever the popup closes. */
function RealProjectCreateForm({ onCancel }: { onCancel: () => void }): ReactElement {
  const client = useQueryClient()
  const cacheActor = useProjectCacheActor()
  const toast = useToastStore((s) => s.toast)
  const guarded = useSessionStore((s) => s.guarded)
  const clearDirty = useSessionStore((s) => s.clearDirty)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [formError, setFormError] = useState('')
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(INITIAL), [form])
  useDirty(dirty)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setForm((f) => ({ ...f, [key]: value }))

  const displayName = form.displayName.trim()
  const slug = form.name.trim()
  const targetValue = form.targetValue.trim()
  const brief = form.brief.trim()
  const targetType = targetTypeOf(targetValue)

  const fieldErrors = {
    displayName: displayName ? undefined : 'A display name is required.',
    name: !slug ? 'A workspace slug is required.' : !SLUG_RE.test(slug) ? 'Use 3-63 lowercase letters, digits or dashes; start and end with a letter or digit.' : undefined,
    targetValue: !targetValue ? 'A target is required.' : targetType === null ? 'Enter a web URL (https://…), an IP address or a CIDR range.' : undefined,
    brief: brief.length >= 20 ? undefined : 'Provide the engagement brief (at least 20 characters) — it is required by the API.',
  }
  const valid = !fieldErrors.displayName && !fieldErrors.name && !fieldErrors.targetValue && !fieldErrors.brief && form.authorized

  const create = useCreateProject({
    onSuccess: (created) => {
      clearDirty()
      toast(`Created engagement ${created.id}`)
      invalidateProjects(client)
      void client.invalidateQueries({ queryKey: projectKeys.detail(cacheActor, created.id) })
      setForm(INITIAL)
      useCreateProjectDialog.getState().hide()
      /* The brief starts the planner's interview: the workspace sends it once. */
      markPlanningSeed(created.id, cacheActor)
      go('project', { id: created.id, tab: 'ai-workspace' })
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Creating the engagement failed.')
    },
  })

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    setFormError('')
    if (!valid || targetType === null) { setFormError('Complete the required fields and confirm the authorization to create the engagement.'); return }
    create.mutate({
      name: slug,
      ...(displayName !== slug ? { displayName } : {}),
      targetType,
      targetValue,
      authorizationConfirmed: true,
      brief,
    })
  }

  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        className="grid grid-cols-1 gap-5"
        aria-busy={create.isPending}
      >
        {formError && (
          <Banner tone="bad" title="Cannot create the engagement" action={<Button size="sm" variant="ghost" onClick={() => setFormError('')}>Dismiss</Button>}>{formError}</Banner>
        )}
        <Card>
          <CardHeader title="Engagement details" sub="These fields persist on the server and survive a refresh." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Display name" required error={fieldErrors.displayName} className="md:col-span-2">
              <Input
                value={form.displayName}
                onChange={(e) => {
                  set('displayName', e.target.value)
                  if (!form.nameTouched) set('name', slugify(e.target.value))
                }}
                placeholder="e.g. Q1 External Assessment"
                aria-invalid={!!fieldErrors.displayName}
              />
            </Field>
            <Field label="Workspace slug" required error={fieldErrors.name} hint="Used as the engagement workspace directory and API identity.">
              <Input
                className="font-mono"
                value={form.name}
                onChange={(e) => set('name', e.target.value.toLowerCase())}
                onBlur={() => set('nameTouched', true)}
                placeholder="q1-external-assessment"
                aria-invalid={!!fieldErrors.name}
              />
            </Field>
            <Field label="Target value" required error={fieldErrors.targetValue} hint="A web URL (http:// or https://), an IP address or a CIDR range. The target type is detected from the value." className="md:col-span-2">
              <Input
                value={form.targetValue}
                onChange={(e) => set('targetValue', e.target.value)}
                placeholder="https://target.example.test or 10.20.0.0/24"
                className="font-mono"
                aria-invalid={!!fieldErrors.targetValue}
              />
            </Field>
            <Field label="Operator brief" required error={fieldErrors.brief} hint="Context the planner drafts scope and rules of engagement from." className="md:col-span-2">
              <Textarea value={form.brief} onChange={(e) => set('brief', e.target.value)} placeholder="Business context, known constraints, expected outcome…" aria-invalid={!!fieldErrors.brief} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Authorization" sub="The API rejects creation without an explicit authorization confirmation." />
          <Check
            checked={form.authorized}
            onChange={(v) => set('authorized', v)}
            label="I confirm this engagement is authorized against the target above."
          />
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => guarded(onCancel)}>Cancel</Button>
          <div className="ml-auto">
            <Button type="submit" variant="primary" icon={FolderPlus} disabled={!valid || create.isPending} title={valid ? undefined : 'Complete the required fields and confirm authorization'}>
              {create.isPending ? 'Creating…' : 'Create Engagement'}
            </Button>
          </div>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted" role="note">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
          The engagement overview composes the onboarding order (Team, Scope &amp; ROE, Planning). Not integrated yet: objectives, ROE document attachment, assessment windows and scheduling. They require the approved lifecycle tickets and are not simulated here.
        </p>
      </form>
    </>
  )
}

/** The real "New project" popup, mounted once in the real shell. */
export function RealProjectCreateDialog(): ReactElement {
  const open = useCreateProjectDialog((s) => s.open)
  const hide = useCreateProjectDialog((s) => s.hide)
  const guarded = useSessionStore((s) => s.guarded)
  const close = (): void => guarded(hide)
  return (
    <Modal open={open} onClose={close} title="New project" width={760}>
      <p className="mb-4 text-sm text-muted">Creates a real engagement through the API. The planner starts its interview from this brief when the project opens.</p>
      <RealProjectCreateForm onCancel={close} />
    </Modal>
  )
}

/** Old #/project-new links: open the popup over the project list instead of a page. */
export function RealProjectNewRoute(): ReactElement {
  useEffect(() => {
    showCreateProject()
    go('projects')
  }, [])
  return <></>
}
