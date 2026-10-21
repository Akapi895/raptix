import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, Lock, RotateCcw, Send } from 'lucide-react'
import { useDirty, useSessionStore } from '../../state/session'
import { persistentFindings } from './presentation-context'
import { sevLabel, SEVS } from './service'
import { TECHNIQUES, type Finding, type Severity } from '../../data'
import { FindingReadError, useFindingDetail, useFindingReferenceOptions, useFindingWrites, useReproductionCaptures } from './query'
import { ReproductionFields, type CaptureListState } from './reproduction-form'
import { draftFromReproduction, draftReproductionPayload } from './reproduction-draft'
import { useDelayedNav } from './delayed-nav'
import { useCreateReason } from './create-reason'
import { FindingDenied } from './access'
import {
  Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, Input, Modal, Mono, PageHeader, Select, Sev, Skeleton, Status, Textarea, cx, useGuard,
} from '../../ui'
import { go, useRoute } from '../../router/navigate'
import { realControlGap, useCan, useMe } from '../../state/console'
import { useFindingFormRead, type FindingFormRead } from './projection'
import { useProjectStore, useToastStore, useUiStore } from '../../state/stores'

const STATUS_LABEL: Record<string, string> = { ai_suggested: 'AI Suggested — unverified', draft: 'Draft', review: 'In Review', returned: 'Returned', confirmed: 'Confirmed', remediation: 'In Remediation', retest: 'Retest', resolved: 'Resolved' }

/* ───────────── FI-03: create / edit ───────────── */
interface Draft { title: string; severity: Severity; severityReason: string; asset: string; op: string; technique: string; desc: string; scopeNote: string; impact: string; rec: string; evidence: string[]; owner: string; kind: string; references: NonNullable<Finding['references']>; stepId?: string; reproduction: import('@raptix/web-contracts').FindingReproductionInput | null | undefined }

/**
 * Finding create/edit form (ticket 32): validation, dirty tracking and the
 * save/submit write run on the typed findings service — one atomic commit
 * per user-visible save (content, evidence links, severity rationale and
 * the optional submit). A refused save commits nothing and leaves the draft
 * in the form with the failure message rendered above it.
 */
export function FindingForm() {
  const route = useRoute()
  const real = persistentFindings
  const db = useFindingFormRead(route.id)
  const detail = useFindingDetail(real ? route.id : undefined)
  if (!real) return <FindingFormBody key={route.id ?? 'new'} editing={route.id ? db.findings.find((f) => f.id === route.id) : undefined} db={db} />
  if (route.id && detail.isPending) return <div aria-busy="true" aria-label="Loading finding"><Skeleton className="h-72" /></div>
  if (route.id && detail.isError) return <FindingDenied id={route.id} error={detail.error as FindingReadError} />
  return <FindingFormBody key={route.id ?? 'new'} editing={detail.data?.finding} db={db} />
}

function FindingFormBody({ editing, db }: { editing: Finding | undefined; db: FindingFormRead }) {
  const route = useRoute()
  const captures = useReproductionCaptures()
  const captureList: CaptureListState = captures.isError
    ? { status: 'error', message: captures.error instanceof Error ? captures.error.message : 'The captures could not be read.' }
    : captures.isPending ? { status: 'loading' } : { status: 'ready' }
  const real = persistentFindings
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const toast = useToastStore((s) => s.toast)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const can = useCan()
  const nav = useDelayedNav()
  const writes = useFindingWrites()
  const referencesQuery = useFindingReferenceOptions()
  const projectId = editing?.projectId || (pid !== 'all' ? pid : '')
  const createReason = useCreateReason(projectId || undefined)
  const guard = useGuard(projectId || undefined)
  const prefill = useMemo(() => persistFilters['finding-prefill'] as { projectId: string; op?: string; technique?: string; asset?: string; title?: string; severity?: string; desc?: string; stepId?: string; evidence?: string[] } | undefined, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persistFilters['finding-prefill']) setFilter('finding-prefill', null) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pf = !editing && prefill && prefill.projectId === projectId ? prefill : undefined
  const project = db.projects.find((p) => p.id === projectId)
  const members = project?.members.filter((m) => m.role !== 'viewer').map((m) => m.user) || []

  const init: Draft = useMemo(() => editing
    ? { title: editing.title, severity: editing.severity, severityReason: editing.severityRationale ?? '', asset: editing.asset, op: editing.op, technique: editing.technique, desc: editing.desc, scopeNote: editing.scopeNote ?? '', impact: editing.impact, rec: editing.rec, evidence: [...editing.evidence], owner: editing.owner, kind: 'Configuration / access control', references: editing.references ?? { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, reproduction: draftFromReproduction(editing.reproduction) }
    : { title: pf?.title || '', severity: (pf?.severity as Severity) || 'medium', severityReason: '', asset: pf?.asset || '', op: pf?.op || '', technique: pf?.technique || '', desc: pf?.desc || '', scopeNote: '', impact: '', rec: '', evidence: (pf?.evidence || []).filter((id) => db.evidence.some((e) => e.id === id && e.projectId === projectId)), owner: members.includes(me.name) ? me.name : members[0] || me.name, kind: 'Configuration / access control', references: { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, reproduction: undefined, stepId: pf?.stepId }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [])
  const [d, setD] = useState<Draft>(init)
  const [baseVersion, setBaseVersion] = useState(editing?.version)
  const queryClient = useQueryClient()
  const [tried, setTried] = useState(false)
  const [saved, setSaved] = useState(false)
  const [preview, setPreview] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const dirty = !saved && JSON.stringify(d) !== JSON.stringify(init)

  const assets = db.assets.filter((a) => a.projectId === projectId)
  const managedAssets = real ? referencesQuery.data?.assets ?? [] : assets.map((asset) => ({ id: asset.id, label: asset.name }))
  const executions = referencesQuery.data?.executions ?? []
  const ops = db.operations.filter((o) => o.projectId === projectId)
  const evs = db.evidence.filter((e) => e.projectId === projectId)
  const assetGap = undefined
  const techniqueGap = referencesQuery.data?.techniqueAvailable === false ? 'Canonical technique references are unavailable.' : undefined
  const impactGap = realControlGap('finding.impact')
  const recGap = realControlGap('finding.recommendation')
  const scopeGap = realControlGap('finding.scopeNote')
  const severityGap = realControlGap('finding.severityRationale')
  const evidenceGap = realControlGap('finding.evidenceLink')
  const editableStatuses = real ? ['draft', 'returned', 'review', 'confirmed', 'remediation', 'retest'] : ['draft', 'returned']
  const locked = !!createReason || (!!editing && !editableStatuses.includes(editing.status))
  const err: Record<string, string> = {}
  if (d.title.trim().length < 5) err.title = 'Enter a finding title (at least 5 characters).'
  if (!assetGap && !d.asset) err.asset = 'Select the affected asset.'
  if (!d.desc.trim()) err.desc = 'Enter a description.'
  if (!impactGap && !d.impact.trim()) err.impact = 'Enter the impact.'
  if (!recGap && !d.rec.trim()) err.rec = 'Enter a recommendation.'
  if (!severityGap && d.severity === 'critical' && !d.severityReason.trim()) err.severityReason = 'Critical severity requires a rationale.'
  const noEvidence = d.evidence.length === 0
  const submitReason = noEvidence ? 'At least 1 piece of evidence is required to submit for review (you can save a draft first).' : ''
  const maySubmit = !editing || ['draft', 'returned'].includes(editing.status)

  const draftPayload = () => ({ title: d.title.trim(), severity: d.severity, severityReason: d.severityReason.trim() || undefined, owner: d.owner, kind: d.kind, desc: d.desc, scopeNote: d.scopeNote, asset: d.asset, impact: d.impact, rec: d.rec, technique: d.technique, op: d.op, stepId: d.stepId, evidence: d.evidence, references: d.references, reproduction: draftReproductionPayload(d.reproduction) })
  const finish = (id: string, msg: string) => {
    setSaved(true)
    toast(msg)
    nav(() => go('finding', { id }), 80)
  }
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  /** Save through the typed service. A refusal returns without navigating —
   *  the draft stays in the form and the failure message is rendered. */
  const persist = async (submit: boolean, navigate: boolean): Promise<string | null> => {
    if (!projectId || saving) return null
    setSaving(true)
    setSaveErr(null)
    const res = await writes.save(editing?.id ?? null, { ...draftPayload(), submit, expectedVersion: baseVersion })
    setSaving(false)
    if (!res.ok) { setSaveErr(res.failure.message); return null }
    setBaseVersion(res.data.version)
    await queryClient.invalidateQueries({ queryKey: ['finding'] })
    const id = res.data.id
    if (navigate) finish(id, submit ? `${id} submitted for review.` : `Draft ${id} saved.`)
    return id
  }
  const saveDraft = async () => {
    setTried(true)
    if (d.title.trim().length < 5) { toast('Enter a finding title (at least 5 characters) before saving a draft.', 'warn'); return }
    await persist(false, true)
  }
  const submit = async () => {
    setTried(true)
    if (Object.keys(err).length) { toast('Please complete the required fields.', 'warn'); return }
    if (submitReason) { toast(submitReason, 'warn'); return }
    await persist(true, true)
  }
  useDirty(dirty, () => {
    if (d.title.trim().length >= 5 && projectId && !locked && !saving) {
      void persist(false, false).then((id) => { if (id) { setSaved(true); toast('Draft saved.') } else setSaved(false) })
    }
  })

  if (editing && pid !== 'all' && editing.projectId !== pid) return <Empty icon={Lock} title={`${editing.id} belongs to project ${editing.projectId}`} action={<Button onClick={() => setSwitcherOpen(true)}>Select project</Button>}>Select the correct project to edit this finding.</Empty>
  if (route.id && !editing) return <Empty icon={AlertTriangle} title="Finding to edit not found" action={<Button onClick={() => go('findings')}>Back to list</Button>} />
  if (!projectId) {
    return (
      <div>
        <PageHeader title="Create Finding" back={{ label: 'Findings', to: () => go('findings') }} />
        <Banner tone="warn" title="Select a project before creating a finding" action={<Button variant="primary" onClick={() => setSwitcherOpen(true)}>Select project</Button>}>
          "All Projects" is for aggregate viewing only. Every finding must belong to exactly one project.
        </Banner>
      </div>
    )
  }
  const returnedNote = editing?.status === 'returned' ? [...editing.comments].reverse()[0] : undefined
  const E = (k: string) => (tried ? err[k] : undefined)

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${editing.id}` : 'Create Finding'}
        sub={`Project ${project?.id} — ${project?.name}. The finding ID is generated on save.`}
        back={{ label: editing ? editing.id : 'Findings', to: () => (editing ? go('finding', { id: editing.id }) : go('findings')) }}
        meta={editing ? <Status kind="finding" value={editing.status} /> : undefined}
      />
      {returnedNote && (
        <Banner tone="bad" title={`Returned by reviewer — ${returnedNote.by}, ${returnedNote.at}`} icon={RotateCcw}>
          <span className="whitespace-pre-wrap">{returnedNote.text}</span>
          <div className="mt-1 text-xs text-muted">Make the requested changes, then click "Submit for Review" to resubmit.</div>
        </Banner>
      )}
      {createReason ? <Banner tone="warn" title="Cannot create / edit finding">{createReason}</Banner>
         : locked ? <Banner tone="warn" title="Finding is no longer editable">This lifecycle stage is immutable. Current status: {STATUS_LABEL[editing!.status]}.</Banner>
          : guard.ro ? <Banner tone="warn" title="Read-only">{guard.reason}</Banner> : null}
      {saveErr && (
        <Banner tone="bad" title="The finding was not saved">
          {saveErr} Your draft is still in the form below — fix the problem and save again.
        </Banner>
      )}
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="General information" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Project" hint="A finding's project cannot be changed."><Input value={`${project?.id} — ${project?.name}`} disabled readOnly /></Field>
            <Field label="Finding ID" hint="Auto-generated"><Input value={editing?.id || 'Generated on save'} disabled readOnly className="font-mono" /></Field>
            <Field label="Finding title" required error={E('title')} className="md:col-span-2"><Input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Example: Access control gap" /></Field>
            <Field label="Severity" required>
              <Select value={d.severity} onChange={(e) => set('severity', e.target.value as Severity)}>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
            </Field>
            <Field label="Owner">
              <Select value={d.owner} onChange={(e) => set('owner', e.target.value)}>{[...new Set([...members, d.owner])].map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
            <Field label={d.severity === 'critical' ? 'Rationale for Critical severity' : 'Severity rationale (optional)'} required={d.severity === 'critical' && !severityGap} error={E('severityReason')} className="md:col-span-2" hint={severityGap ?? 'The rationale is saved as a comment in the finding history.'}>
              <Textarea disabled={!!severityGap} value={d.severityReason} onChange={(e) => set('severityReason', e.target.value)} className="min-h-16" placeholder="Explain the basis for the severity rating" />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Analysis" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Affected asset" required error={E('asset')} hint={referencesQuery.isPending ? 'Loading managed assets…' : `${managedAssets.length} managed assets in ${projectId}`}>
              <Select value={real ? d.references.assetId ?? '' : d.asset} onChange={(e) => { const asset = managedAssets.find((item) => real ? item.id === e.target.value : item.label === e.target.value); set('references', { ...d.references, assetId: real ? e.target.value || null : null }); set('asset', asset?.label ?? '') }}><option value="">— Select an asset —</option>{managedAssets.map((asset) => <option key={asset.id} value={real ? asset.id : asset.label}>{asset.label} ({asset.id})</option>)}</Select>
            </Field>
            <Field label="Related execution" hint={referencesQuery.data?.truncated ? 'Execution options are bounded. Refine before linking.' : 'Links only owned execution threads and runs in this engagement.'}>
              {real ? <Select value={JSON.stringify(d.references)} onChange={(e) => { const selected = executions.find((item) => JSON.stringify({ ...d.references, threadId: item.threadId, runId: item.runId, bindingId: item.bindingId }) === e.target.value); const refs = selected ? { ...d.references, threadId: selected.threadId, runId: selected.runId, bindingId: selected.bindingId } : { ...d.references, threadId: null, runId: null, bindingId: null }; set('references', refs); set('op', refs.runId ?? refs.bindingId ?? refs.threadId ?? '') }}><option value={JSON.stringify({ ...d.references, threadId: null, runId: null, bindingId: null })}>— No linked execution —</option>{executions.map((execution) => { const refs = { ...d.references, threadId: execution.threadId, runId: execution.runId, bindingId: execution.bindingId }; return <option key={JSON.stringify(refs)} value={JSON.stringify(refs)}>{execution.runId ?? execution.bindingId ?? execution.threadId}</option> })}</Select>
                : <Select value={d.op} onChange={(e) => set('op', e.target.value)}><option value="">— No linked operation —</option>{ops.map((operation) => <option key={operation.id} value={operation.id}>{operation.id} — {operation.name}</option>)}</Select>}
            </Field>
            <Field label="ATT&CK technique (if applicable)" hint={techniqueGap ?? (referencesQuery.data?.techniqueAvailable ? 'Validated against the canonical technique corpus on save.' : 'Select a project to check the canonical corpus.')}>
              {real ? <Input value={d.references.techniqueId ?? ''} onChange={(e) => { set('references', { ...d.references, techniqueId: e.target.value.trim() || null }); set('technique', e.target.value.trim()) }} placeholder="T1059.001" disabled={!!techniqueGap} />
                : <Select value={d.technique} onChange={(e) => set('technique', e.target.value)}><option value="">— Not applicable —</option>{TECHNIQUES.map((technique) => <option key={technique.id} value={technique.id}>{technique.id} — {technique.name}</option>)}</Select>}
            </Field>
            <Field label="Conditions / scope of impact" hint={scopeGap ?? undefined}><Input disabled={!!scopeGap} value={d.scopeNote} onChange={(e) => set('scopeNote', e.target.value)} placeholder="Example: applies only to demo accounts in the lab" /></Field>
            <Field label="Description" required error={E('desc')} className="md:col-span-2"><Textarea value={d.desc} onChange={(e) => set('desc', e.target.value)} /></Field>
            <Field label="Impact" required={!impactGap} error={E('impact')} hint={impactGap ?? undefined}><Textarea disabled={!!impactGap} value={d.impact} onChange={(e) => set('impact', e.target.value)} /></Field>
            <Field label="Recommendation" required={!recGap} error={E('rec')} hint={recGap ?? undefined}><Textarea disabled={!!recGap} value={d.rec} onChange={(e) => set('rec', e.target.value)} /></Field>
            <div className="md:col-span-2"><ReproductionFields value={d.reproduction} onChange={(reproduction) => set('reproduction', reproduction)} captures={captures.data ?? []} captureList={captureList} linked={editing?.reproduction?.artifact ?? null} onRetryCaptures={() => void captures.refetch()} /></div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Evidence" sub={`Only evidence from ${projectId} is listed. You can upload more files in the Evidence tab after saving.`} />
          {evidenceGap ? <div className="text-sm text-muted">{evidenceGap}</div> : evs.length === 0 ? <div className="text-sm text-muted">This project has no evidence yet. Save a draft, then upload from the detail page.</div> : (
            <ul className="space-y-2">
              {evs.map((e) => {
                const other = !!e.findingId && e.findingId !== editing?.id
                const hide = e.sensitive && !can('viewSensitive')
                return (
                  <li key={e.id} className={cx('flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5', (other || hide) && 'opacity-60')}>
                    <Check checked={d.evidence.includes(e.id)} disabled={other || hide} onChange={(v) => set('evidence', v ? [...d.evidence, e.id] : d.evidence.filter((x) => x !== e.id))} label={<span className="flex items-center gap-2"><Mono className="text-accent">{e.id}</Mono>{hide ? 'Sensitive file' : e.name}</span>} />
                    <span className="text-xs text-muted">{e.kind} · {e.source}</span>
                    {e.sensitive && <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span>}
                    {other && <span className="text-xs text-muted">Already linked to {e.findingId}</span>}
                    {hide && <span className="text-xs text-muted">Outside your permission scope</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </fieldset>
      <div className="sticky bottom-0 -mx-1 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-warn">Unsaved changes</span>}
        {!locked && submitReason && <span className="mr-auto flex items-center gap-1.5 text-xs text-muted"><Lock size={12} aria-hidden />{submitReason}</span>}
        <Button variant="ghost" onClick={() => (editing ? go('finding', { id: editing.id }) : go('findings'))}>Cancel</Button>
        <Button onClick={() => setPreview(true)} icon={FileText}>Preview</Button>
        <Button onClick={saveDraft} disabled={locked || saving} title={locked ? createReason || 'Cannot edit in the current status.' : !maySubmit ? 'Content changes invalidate confirmation and return the finding to review.' : ''}>{maySubmit ? 'Save Draft' : 'Save for Re-review'}</Button>
        <Button variant="primary" icon={Send} onClick={submit} disabled={locked || saving || !!submitReason || !maySubmit} title={locked ? createReason || 'Cannot edit in the current status.' : !maySubmit ? 'Use Save for Re-review to save content and invalidate its previous confirmation.' : submitReason}>Submit for Review</Button>
      </div>
      <Modal open={preview} onClose={() => setPreview(false)} title="Finding preview" width={640} footer={<Button onClick={() => setPreview(false)}>Close</Button>}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><Sev v={d.severity} /><span className="font-semibold">{d.title || '(untitled)'}</span></div>
          <DescList items={[{ k: 'Project', v: projectId }, { k: 'Asset', v: d.asset }, { k: 'Operation', v: d.op }, { k: 'Technique', v: d.technique }, { k: 'Owner', v: d.owner }, { k: 'Evidence', v: d.evidence.join(', ') }]} />
          <div><div className="text-xs text-muted">Description</div><p>{d.desc || '—'}</p></div>
          <div><div className="text-xs text-muted">Impact</div><p>{d.impact || '—'}</p></div>
          <div><div className="text-xs text-muted">Recommendation</div><p>{d.rec || '—'}</p></div>
        </div>
      </Modal>
    </div>
  )
}
