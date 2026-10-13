/**
 * Project creation wizard (tickets 17–19, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The wizard shell — stepper, step navigation, one validated draft with
 * dirty tracking and the unsaved-changes guard — lives in
 * `src/features/wizard/`. Steps 1 (information), 2 (objectives, RHF
 * `useFieldArray`), 3 (scope/ROE essentials and asset in/out lists) and 4
 * (ROE document, reviewer and members) render React Hook Form fields over
 * the shared Zod schema; step 5 (review & create) lists the composed draft
 * with pass/review/fail gates and submits through the handler-owned
 * creation transaction (ticket 19) — save-draft and create both commit via
 * the single legacy store action, no second creation path.
 */
import { useState } from 'react'
import { Controller, useFieldArray } from 'react-hook-form'
import { AlertTriangle, ArrowDown, ArrowUp, Check as CheckIcon, FileText, Lock, Plus, Trash2, Upload, X } from 'lucide-react'
import { useStore } from '../store'
import { ROLE_LABEL } from '../auth/policy'
import { USERS, type Role } from '../data'
import { Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, IconButton, Input, PageHeader, Select, Status, Tabs, Textarea, cx } from '../ui'
import { LIMIT_PRESETS, WIZARD_STEPS, fmtDate } from '../features/wizard/draft'
import { useProjectWizard } from '../features/wizard/use-project-wizard'

const TYPES = ['Red Team', 'Purple Team', 'Assessment']
const TZS: [string, string][] = [['UTC+07:00', 'Asia/Ho_Chi_Minh (UTC+7)'], ['UTC+00:00', 'UTC (UTC+0)']]
const ASSET_TYPES = ['Host', 'URL', 'Application', 'Subnet', 'Service']
const RANK: Record<Role, number> = { viewer: 1, analyst: 2, operator: 2, reviewer: 3, manager: 4, admin: 5 }
const ROLE_PERM: Record<Role, string> = { admin: 'Organization-wide administration', manager: 'Full control within the project', operator: 'Run operations, create findings', reviewer: 'Review and approve', analyst: 'Create findings and evidence', viewer: 'View only (no actions)' }

const asMessage = (e: unknown): string | undefined =>
  e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : undefined

export function ProjectNew() {
  const { db, me, go } = useStore()
  const wiz = useProjectWizard()
  const { form, w, step, maxStep, isDirty, issues: submitIssues, blocking, saving, err, setErr, next, back, jump, create, saveDraft, set, update, shown } = wiz
  const { register, control, formState: { errors } } = form
  const objective = useFieldArray({ control, name: 'objectives' })

  const [idTouched, setIdTouched] = useState(false)
  const [tagIn, setTagIn] = useState('')
  const [scopeTab, setScopeTab] = useState('in')
  const [newAsset, setNewAsset] = useState({ name: '', ident: '', type: 'Host' })
  const [assetErr, setAssetErr] = useState('')
  const [customLimit, setCustomLimit] = useState('')
  const [checkRes, setCheckRes] = useState<string[] | null>(null)
  const [newMember, setNewMember] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const inAssets = w.assets.filter((a) => a.scope === 'in')
  const outAssets = w.assets.filter((a) => a.scope === 'out')
  const canSubmit = blocking.length === 0 && confirmed
  const minimalOk = wiz.live[0] && Object.keys(wiz.live[0]).length === 0
  const objError = asMessage((errors.objectives as { root?: unknown } | null | undefined)?.root) ?? asMessage(errors.objectives)
  /* The ROE banner stays on the attempted-gated live check (not `errors`):
   * table edits via `update` (removing the reviewer) must re-reveal it
   * without a new blur/trigger, matching the legacy show-on-attempt behavior. */
  const e3 = shown(3)

  const clients = Array.from(new Set(db.projects.map((p) => p.client)))
  const assignable = (Object.keys(RANK) as Role[]).filter((r) => RANK[r] <= RANK[me.role])
  const candidates = USERS.filter((u) => u.name !== w.owner && !w.members.some((m) => m.user === u.name))

  const addAsset = (scope: 'in' | 'out') => {
    const name = newAsset.name.trim(), ident = newAsset.ident.trim()
    if (!name || !ident) { setAssetErr('Enter the asset name and identifier (synthetic FQDN / IP).'); return }
    if (w.assets.some((a) => a.ident === ident)) { setAssetErr(`Identifier ${ident} is already in the list.`); return }
    setAssetErr('')
    set('assets', [...w.assets, { name, ident, type: newAsset.type, scope }])
    setNewAsset({ name: '', ident: '', type: newAsset.type })
  }
  const runCheck = () => {
    const lines: string[] = []
    const dup = inAssets.filter((a) => outAssets.some((o) => o.ident === a.ident))
    lines.push(`${inAssets.length} in-scope assets, ${outAssets.length} out-of-scope assets.`)
    if (dup.length) lines.push(`Conflict: ${dup.map((a) => a.ident).join(', ')} appears in both lists.`)
    const other = db.assets.filter((a) => inAssets.some((x) => x.ident === a.ident) && a.projectId)
    if (other.length) lines.push(`Warning: ${other.map((a) => `${a.ident} already belongs to project ${a.projectId}`).join('; ')}.`)
    if (!inAssets.length) lines.push('No in-scope assets. You can save a draft but cannot submit for approval.')
    if (!dup.length && !other.length && inAssets.length) lines.push('No conflicts found. This is a preview only and does not replace reviewer approval.')
    setCheckRes(lines)
  }
  const AssetCards = ({ list, scope }: { list: typeof w.assets; scope: 'in' | 'out' }) =>
    list.length === 0 ? (
      <div className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
        {scope === 'in' ? 'No in-scope assets yet. You can save a draft and add them later, but at least one is required to submit for approval.' : 'No excluded targets declared. List any systems that must never be touched.'}
      </div>
    ) : (
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {list.map((a) => (
          <li key={a.ident} className={cx('flex items-center gap-3 rounded-lg border p-3', scope === 'out' ? 'border-bad/40 bg-bad/5' : 'border-line bg-bg')}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className="truncate font-mono text-xs text-muted">{a.ident} · {a.type}</div>
              {scope === 'out' && <div className="mt-1 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />Do not touch. Excluded from operation target selection</div>}
            </div>
            <IconButton icon={Trash2} label={`Remove ${a.name}`} onClick={() => set('assets', w.assets.filter((x) => x.ident !== a.ident))} />
          </li>
        ))}
      </ul>
    )

  if (!wiz.canCreate) {
    return (
      <>
        <PageHeader title="Create Project" crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'Create Project' }]} />
        <Empty icon={Lock} title="You do not have permission to create projects" action={<Button onClick={() => go('projects')}>Back to Projects</Button>}>
          Only a Red Team Manager or Organization Admin can create projects. Current role: {ROLE_LABEL[me.role]}.
        </Empty>
      </>
    )
  }

  /* ───── render ───── */
  return (
    <>
      <PageHeader
        title="Create New Project"
        sub="Define details, objectives, scope, ROE and members. You can save a draft at any time; running operations needs an approved project and ROE."
        crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'Create Project' }]}
        meta={<span className="inline-flex h-6 items-center rounded-full border border-neutral/30 bg-neutral/12 px-2.5 text-xs text-neutral">{isDirty ? 'Draft: not saved' : 'Empty form'}</span>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm" data-testid="new-project-context">
        <span className="font-medium">Creating a new project</span><span className="text-muted">· No project selected · {w.name.trim() || 'Untitled draft'} <span className="font-mono">({w.id || 'no code'})</span> · ROE-{w.id.slice(-3)}-v1 (draft) · not saved yet</span>
      </div>

      <ol className="no-scrollbar mb-6 flex gap-2 overflow-x-auto" aria-label="Project creation steps">
        {WIZARD_STEPS.map((s, i) => {
          const visited = i <= maxStep && i !== step
          const invalid = visited && Object.keys(shown(i)).length > 0
          const complete = visited && i < step && !invalid
          return (
            <li key={s.id} className="flex-1" style={{ minWidth: 150 }}>
              <button
                disabled={i > maxStep} onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}
                className={cx('flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition', i === step ? 'border-accent bg-accent/10 text-fg' : invalid ? 'border-bad/50 text-fg' : complete ? 'border-ok/40 text-fg hover:bg-hover' : 'border-line text-muted')}
              >
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', i === step ? 'bg-accent text-white' : invalid ? 'bg-bad text-white' : complete ? 'bg-ok text-white' : 'bg-hover')}>
                  {invalid ? '!' : complete ? <CheckIcon size={12} /> : i + 1}
                </span>
                <span className="font-medium">{s.name.slice(3)}</span>
                {invalid && <span className="ml-auto text-[11px] text-bad">Has errors</span>}
              </button>
            </li>
          )
        })}
      </ol>

      {err && <Banner tone="bad" title="Cannot create the project yet" action={<Button size="sm" variant="ghost" onClick={() => setErr('')}>Dismiss</Button>}>{err}</Banner>}

      <div className={cx('grid grid-cols-1 gap-5', step < 4 && 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
        <div className="min-w-0">
          {/* ───── STEP 1 — migrated (RHF + Zod, ticket 17) ───── */}
          {step === 0 && (
            <Card>
              <CardHeader title="Basic Details" sub="Fields marked * are required." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Project Name" required error={errors.name?.message} className="md:col-span-2">
                  <Input {...register('name')} placeholder="e.g. Internal Red Team Exercise Q1" aria-invalid={!!errors.name} />
                </Field>
                <Field label="Project Code" required error={errors.id?.message} hint="Auto-suggested from the assessment type; checked for duplicates on create.">
                  <Controller control={control} name="id" render={({ field }) => (
                    <Input {...field} className="font-mono" onChange={(e) => { setIdTouched(true); field.onChange(e.target.value.toUpperCase()) }} aria-invalid={!!errors.id} />
                  )} />
                </Field>
                <Field label="Assessment Type" required>
                  <Controller control={control} name="type" render={({ field }) => (
                    <Select {...field} onChange={(e) => { const t = e.target.value; field.onChange(t); if (!idTouched) form.setValue('id', wiz.suggestId(t)) }}>
                      {TYPES.map((t) => <option key={t}>{t}</option>)}
                    </Select>
                  )} />
                </Field>
                <Field label="Client" required error={errors.client?.message} hint="Pick a suggestion or type a new name.">
                  <Input {...register('client')} list="prj-clients" placeholder="e.g. Example Corp A (Demo)" aria-invalid={!!errors.client} />
                  <datalist id="prj-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
                <Field label="Primary Owner" required error={errors.owner?.message}>
                  <Select {...register('owner')}>
                    {USERS.filter((u) => u.role === 'manager' || u.role === 'admin').map((u) => <option key={u.name}>{u.name}</option>)}
                  </Select>
                </Field>
                <Field label="Start Date" required error={errors.start?.message}><Input type="date" {...register('start')} /></Field>
                <Field label="End Date" required error={errors.end?.message}><Input type="date" {...register('end')} min={w.start} aria-invalid={!!errors.end} /></Field>
                <Field label="Time zone" required>
                  <Select {...register('tz')}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                </Field>
                <Field label="Tags" hint="Press Enter to add a tag.">
                  <Input
                    value={tagIn} onChange={(e) => setTagIn(e.target.value)} placeholder="e.g. internal, cloud"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const t = tagIn.trim(); if (t && !w.tags.includes(t)) set('tags', [...w.tags, t]); setTagIn('') } }}
                  />
                </Field>
                {w.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    {w.tags.map((t) => (
                      <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-bg pl-3 pr-1 text-xs">
                        {t}<button aria-label={`Remove tag ${t}`} onClick={() => set('tags', w.tags.filter((x) => x !== t))} className="rounded-full p-1 text-muted hover:bg-hover hover:text-fg"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <Field label="Description" className="md:col-span-2"><Textarea {...register('desc')} placeholder="Business context and overall scope of the engagement (synthetic data)." /></Field>
              </div>
            </Card>
          )}

          {/* ───── STEP 2 — migrated (RHF field array, ticket 17) ───── */}
          {step === 1 && (
            <Card>
              <CardHeader title="Objectives" sub="Specific objectives are tracked in the project Overview and Team tabs." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Main Objective" required error={errors.goal?.message} className="md:col-span-2">
                  <Textarea {...register('goal')} placeholder="e.g. Assess SOC detection and response against an insider-threat scenario." aria-invalid={!!errors.goal} />
                </Field>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Specific objectives <span className="text-bad">*</span></div>
                  <Button size="sm" icon={Plus} onClick={() => objective.append({ text: '', criteria: '' })}>Add Objective</Button>
                </div>
                {objError && <div className="mb-2 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{objError}</div>}
                <ul className="space-y-2">
                  {objective.fields.map((f, i) => {
                    const o = w.objectives[i]
                    const warn = o && ((o.text.trim() && !o.criteria.trim()) || (!o.text.trim() && o.criteria.trim()))
                    return (
                      <li key={f.id} className={cx('rounded-lg border p-3', warn ? 'border-warn/40' : 'border-line')}>
                        <div className="flex items-start gap-3">
                          <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold">{i + 1}</span>
                          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
                            <Input {...register(`objectives.${i}.text`)} aria-label={`Objective ${i + 1}`} placeholder="Specific objective" />
                            <Input {...register(`objectives.${i}.criteria`)} aria-label={`Success criterion ${i + 1}`} placeholder="Measurable success criterion" />
                          </div>
                          <div className="flex shrink-0">
                            <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => objective.move(i, i - 1)} />
                            <IconButton icon={ArrowDown} label="Move down" disabled={i === w.objectives.length - 1} onClick={() => objective.move(i, i + 1)} />
                            <IconButton icon={Trash2} label="Remove objective" disabled={w.objectives.length === 1} onClick={() => objective.remove(i)} />
                          </div>
                        </div>
                        {warn && <div className="mt-2 pl-9 text-xs text-warn">Incomplete objective: both the objective and its success criterion are needed.</div>}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Success Criteria"><Textarea {...register('success')} placeholder="e.g. 80% or more of techniques have detection data." /></Field>
                <Field label="Assumptions & Metrics"><Textarea {...register('metrics')} placeholder="e.g. Mean time to detect, coverage rate." /></Field>
                <Field label="Business Context"><Input {...register('unit')} placeholder="e.g. SOC, Infrastructure team" /></Field>
                <Field label="Reporting Requirements"><Textarea {...register('reportReq')} placeholder="e.g. Executive summary plus technical appendix." /></Field>
              </div>
            </Card>
          )}

          {/* ───── STEP 3 — migrated (RHF + Zod, ticket 18) ───── */}
          {step === 2 && (
            <Card>
              <CardHeader title="Scope" sub="Assets can be added after saving a draft. Submitting for approval needs in-scope assets, an assessment window and an emergency contact."
                actions={<Button size="sm" onClick={runCheck}>Check Scope</Button>} />
              <Field label="Scope Description & Boundaries" required error={errors.scopeDesc?.message} className="mb-4">
                <Textarea {...register('scopeDesc')} placeholder="e.g. Lab environment with 3 web/API/Windows servers; the restricted zone is excluded." aria-invalid={!!errors.scopeDesc} />
              </Field>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Assessment Window" required error={errors.window?.message}><Input {...register('window')} aria-invalid={!!errors.window} /></Field>
                <Field label="Data Sensitivity"><Select {...register('sensitivity')}>{['Synthetic / lab only', 'Internal', 'Confidential'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
              </div>
              {checkRes && (
                <Banner tone={checkRes.some((l) => l.startsWith('Conflict') || l.startsWith('Warning')) ? 'warn' : 'info'} title="Scope check result (preview)" action={<Button size="sm" variant="ghost" onClick={() => setCheckRes(null)}>Hide</Button>}>
                  <ul className="list-disc pl-5">{checkRes.map((l) => <li key={l}>{l}</li>)}</ul>
                </Banner>
              )}
              <Tabs
                value={scopeTab} onChange={setScopeTab}
                tabs={[{ id: 'in', label: 'Allowed Targets', count: inAssets.length }, { id: 'out', label: 'Excluded Targets', count: outAssets.length }]}
              />
              {(scopeTab === 'in' || scopeTab === 'out') && (
                <div>
                  <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.4fr_140px_auto] md:items-end">
                    <Field label="Asset name"><Input value={newAsset.name} onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })} placeholder="web-lab-01" /></Field>
                    <Field label="Identifier (synthetic FQDN / IP)"><Input className="font-mono" value={newAsset.ident} onChange={(e) => setNewAsset({ ...newAsset, ident: e.target.value })} placeholder="web-lab-01.lab.local" /></Field>
                    <Field label="Type"><Select value={newAsset.type} onChange={(e) => setNewAsset({ ...newAsset, type: e.target.value })}>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                    <Button icon={Plus} variant="primary" onClick={() => addAsset(scopeTab as 'in' | 'out')}>{scopeTab === 'in' ? 'Add Asset' : 'Add Exclusion'}</Button>
                  </div>
                  {assetErr && <div className="mb-3 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{assetErr}</div>}
                  <AssetCards list={scopeTab === 'in' ? inAssets : outAssets} scope={scopeTab as 'in' | 'out'} />
                </div>
              )}
            </Card>
          )}

          {/* ───── STEP 4 — migrated (RHF + Zod, ticket 18) ───── */}
          {step === 3 && (
            <div className="space-y-4">
            <Card>
              <CardHeader title="ROE & Approvals" sub="ROE version, restrictions, contacts and requested reviewer. Submitting does not approve it: a reviewer must decide." />
              <div className="mb-4 text-sm"><span className="text-muted">ROE version:</span> <span className="font-mono">ROE-{w.id.slice(-3)}-v1</span> <span className="ml-2 text-xs text-muted">(Draft. Starts as a draft; scope changes after approval create a new draft version)</span></div>
              {(
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <div className="mb-1.5 text-xs font-medium text-muted">Restrictions</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {[...LIMIT_PRESETS, ...w.limits.filter((l) => !LIMIT_PRESETS.includes(l))].map((l) => (
                        <Check key={l} checked={w.limits.includes(l)} onChange={(v) => set('limits', v ? [...w.limits, l] : w.limits.filter((x) => x !== l))} label={l} />
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input aria-label="Custom restriction" value={customLimit} onChange={(e) => setCustomLimit(e.target.value)} placeholder="Add another restriction…" />
                      <Button onClick={() => { const t = customLimit.trim(); if (t && !w.limits.includes(t)) set('limits', [...w.limits, t]); setCustomLimit('') }}>Add</Button>
                    </div>
                  </div>
                  <Field label="Emergency Contact" required hint={!w.emergency.trim() ? 'Optional for a draft; required to submit for approval.' : undefined}>
                    <Input {...register('emergency')} placeholder="Full name, phone (synthetic)" />
                  </Field>
                  <Field label="Approval Contacts / Incident Channel"><Input {...register('channel')} placeholder="e.g. 24/7 SOC channel (synthetic)" /></Field>
                  <Field label="Requested Reviewer">
                    <Controller control={control} name="approver" render={({ field }) => (
                      <Select {...field} onChange={(e) => { const u = e.target.value; field.onChange(u); update((x) => ({ ...x, approver: u, members: x.members.some((m) => m.user === u) ? x.members : [...x.members, { user: u, role: USERS.find((y) => y.name === u)!.role }] })) }}>{USERS.filter((u) => u.role === 'reviewer' || u.role === 'admin').map((u) => <option key={u.name}>{u.name}</option>)}</Select>
                    )} />
                  </Field>
                </div>
              )}

              <div className="mt-4"><div className="mb-1.5 text-xs font-medium text-muted">ROE Document</div>
              {(
                <div>
                  {w.roeFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
                      <FileText size={20} className="text-accent" />
                      <div className="flex-1"><div className="font-mono text-sm">{w.roeFile}</div><div className="text-xs text-muted">Simulated file, 214 KB, uploaded by {me.name}</div></div>
                      <IconButton icon={Trash2} label="Remove file" onClick={() => set('roeFile', '')} />
                    </div>
                  ) : (
                    <Empty icon={Upload} title="No ROE document attached" action={<Button icon={Upload} onClick={() => set('roeFile', `ROE-${w.id}-v1.pdf`)}>Attach ROE document (demo)</Button>}>
                      Attach the signed ROE or the client's testing authorization. This is a simulated file; no real data is uploaded.
                    </Empty>
                  )}
                </div>
              )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Members & Reviewer" sub={`You (${ROLE_LABEL[me.role]}) cannot assign a role higher than your own.`} />
              {e3.approver && <Banner tone="bad" title="A requested reviewer is required">{e3.approver}</Banner>}
              <div className="no-scrollbar overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="h-11 px-4 font-medium">Name</th><th className="px-4 font-medium">Email</th><th className="px-4 font-medium">Project role</th><th className="px-4 font-medium">Permissions</th><th className="px-4 font-medium">Joined</th><th className="px-4 font-medium">Requested reviewer</th><th className="w-12" />
                  </tr></thead>
                  <tbody>
                    <tr className="h-14 border-b border-line/60 bg-hover/40">
                      <td className="px-4 font-medium">{w.owner} <span className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">Owner</span></td>
                      <td className="px-4 text-muted">{USERS.find((u) => u.name === w.owner)?.email}</td>
                      <td className="px-4">{ROLE_LABEL.manager}</td><td className="px-4 text-muted">{ROLE_PERM.manager}</td><td className="px-4 text-muted">On project creation</td><td className="px-4 text-neutral">—</td><td />
                    </tr>
                    {w.members.map((m) => {
                      const u = USERS.find((x) => x.name === m.user)!
                      const canApprove = m.role === 'reviewer' || m.role === 'admin'
                      return (
                        <tr key={m.user} className="h-14 border-b border-line/60 last:border-0">
                          <td className="px-4 font-medium">{m.user}</td>
                          <td className="px-4 text-muted">{u.email}</td>
                          <td className="px-4">
                            <Select aria-label={`Role of ${m.user}`} className="!h-9 min-w-44" value={m.role} onChange={(e) => { const role = e.target.value as Role; update((s) => ({ ...s, members: s.members.map((x) => (x.user === m.user ? { ...x, role } : x)), approver: s.approver === m.user && role !== 'reviewer' && role !== 'admin' ? '' : s.approver })) }}>
                              {(Object.keys(RANK) as Role[]).map((r) => <option key={r} value={r} disabled={!assignable.includes(r)}>{ROLE_LABEL[r]}{!assignable.includes(r) ? ' (above your role)' : ''}</option>)}
                            </Select>
                          </td>
                          <td className="px-4 text-muted">{ROLE_PERM[m.role as Role]}</td>
                          <td className="px-4"><Status kind="generic" value="neutral" size="sm" label="Will be invited" /></td>
                          <td className="px-4">
                            <label className={cx('inline-flex items-center gap-2 text-xs', !canApprove && 'opacity-40')}>
                              <input type="radio" name="approver" disabled={!canApprove} checked={w.approver === m.user} onChange={() => set('approver', m.user)} className="accent-[var(--c-accent)]" />
                              {w.approver === m.user ? 'Selected' : 'Select'}
                            </label>
                          </td>
                          <td><IconButton icon={Trash2} label={`Remove ${m.user}`} onClick={() => update((s) => ({ ...s, members: s.members.filter((x) => x.user !== m.user), approver: s.approver === m.user ? '' : s.approver }))} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <Field label="Pick from organization accounts" className="min-w-64 flex-1">
                  <Select value={newMember} onChange={(e) => setNewMember(e.target.value)}>
                    <option value="">Select a user</option>
                    {candidates.map((u) => <option key={u.name} value={u.name}>{u.name} — {u.email}</option>)}
                  </Select>
                </Field>
                <Button icon={Plus} disabled={!newMember} onClick={() => {
                  const u = USERS.find((x) => x.name === newMember)!
                  const role = RANK[u.role] <= RANK[me.role] ? u.role : me.role
                  update((s) => ({ ...s, members: [...s.members, { user: u.name, role }], approver: s.approver || (role === 'reviewer' ? u.name : '') }))
                  setNewMember('')
                }}>Add Member</Button>
              </div>
              {candidates.length === 0 && <div className="mt-2 text-xs text-muted">All organization accounts have been added.</div>}
            </Card>
            </div>
          )}

          {/* ───── STEP 5 — review & submission (ticket 19) ───── */}
          {step === 4 && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-4">
                <Card>
                  <CardHeader title="1. Basic Details" actions={<Button size="sm" variant="ghost" onClick={() => jump(0)}>Edit</Button>} />
                  <DescList items={[{ k: 'Project Name', v: w.name }, { k: 'Project Code', v: <span className="font-mono">{w.id}</span> }, { k: 'Client', v: w.client }, { k: 'Type', v: w.type }, { k: 'Timeline', v: `${fmtDate(w.start)} – ${fmtDate(w.end)} (${w.tz})` }, { k: 'Primary Owner', v: w.owner }, { k: 'Tags', v: w.tags.join(', ') }]} cols={3} />
                </Card>
                <Card>
                  <CardHeader title="2. Objectives" actions={<Button size="sm" variant="ghost" onClick={() => jump(1)}>Edit</Button>} />
                  <p className="mb-3 text-sm">{w.goal || '—'}</p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">{w.objectives.filter((o) => o.text.trim()).map((o, i) => <li key={i}>{o.text} <span className="text-muted">— {o.criteria || 'no criteria yet'}</span></li>)}</ol>
                </Card>
                <Card>
                  <CardHeader title="3. Scope & ROE" actions={<Button size="sm" variant="ghost" onClick={() => jump(2)}>Edit</Button>} />
                  <DescList items={[{ k: 'Scope description', v: w.scopeDesc }, { k: 'Assessment window', v: w.window }, { k: 'In scope', v: inAssets.map((a) => a.name).join(', ') || 'None yet' }, { k: 'Excluded', v: outAssets.map((a) => a.name).join(', ') || 'None declared' }, { k: 'Emergency contact', v: w.emergency || 'None yet' }, { k: 'ROE document', v: w.roeFile || 'Not attached' }]} />
                  <div className="mt-3 text-xs text-muted">Restrictions: {w.limits.join('; ') || '—'}</div>
                </Card>
                <Card>
                  <CardHeader title="4. Members & Reviewer" actions={<Button size="sm" variant="ghost" onClick={() => jump(3)}>Edit</Button>} />
                  <ul className="space-y-1 text-sm">
                    <li>{w.owner} — {ROLE_LABEL.manager} (owner)</li>
                    {w.members.map((m) => <li key={m.user}>{m.user} — {ROLE_LABEL[m.role as Role]}{w.approver === m.user && <span className="ml-2 text-xs text-accent">Requested reviewer</span>}</li>)}
                  </ul>
                  <p className="mt-3 text-xs text-muted">Visibility policy: only project members plus Managers, Reviewers and Organization Admins can see this project. Clients and viewers see only projects they are invited to.</p>
                </Card>
              </div>
              <div>
                <Card className="xl:sticky xl:top-4">
                  <CardHeader title="Validation" sub="Pass / Needs review / Fail. Failures block only Submit for Approval, never Create Draft." />
                  <ul className="space-y-3">
                    {submitIssues.map((c) => (
                      <li key={c.key} className="flex items-start gap-3">
                        <Status kind="check" value={c.ok ? 'pass' : c.level === 'review' ? 'review' : 'fail'} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{c.label}</div>
                          <div className="text-xs text-muted">{c.detail}</div>
                        </div>
                        {!c.ok && <Button size="sm" variant="ghost" onClick={() => jump(c.step)}>Resolve</Button>}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Outcome 1 — Create Draft</div>
                    <p className="mb-2 mt-1 text-xs text-muted">Always allowed. Saves the project as Draft with a draft ROE. Nothing is submitted, no approval is requested and execution stays locked.</p>
                    <Button className="w-full" disabled={saving} onClick={() => void create(false)} title={minimalOk ? 'Save as a draft project' : 'Opens Step 1 to complete the name, client, dates and owner'}>{saving ? 'Saving…' : 'Create Draft'}</Button>
                  </div>
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Outcome 2 — Submit for Approval</div>
                    <p className="mb-2 mt-1 text-xs text-muted">Sends the ROE to the reviewer. Submitting does not approve it; a reviewer must decide.</p>
                    <Check checked={confirmed} onChange={setConfirmed} label="I confirm the scope and ROE above are accurate. This does not replace the reviewer's approval." />
                    <Button variant="primary" className="mt-3 w-full" disabled={!canSubmit || saving} onClick={() => void create(true)} title={canSubmit ? undefined : blocking.length ? `Not ready: ${blocking[0].label}` : 'Tick the scope confirmation first'}>Submit for Approval</Button>
                    {!canSubmit && (
                      <div className="mt-2 text-xs text-warn" role="status">
                        {blocking.length ? <>Submit is blocked by:<ul className="mt-1 list-disc pl-4">{blocking.map((b) => <li key={b.key}>{b.label} <button className="text-accent underline" onClick={() => jump(b.step)}>Resolve</button></li>)}</ul>You can still create a draft.</> : 'Tick the scope confirmation to submit for approval.'}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* footer */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => go('projects')}>Cancel</Button>
            <div className="ml-auto flex flex-wrap gap-2">
              {step > 0 && <Button onClick={back}>Back</Button>}
              <Button onClick={saveDraft} disabled={saving} title="Create the project as a Draft with the data entered so far">Save Draft</Button>
              {step < 4 && <Button variant="primary" onClick={() => void next()}>Next</Button>}
            </div>
          </div>
        </div>

        {step < 4 && (
          <aside className="min-w-0">
            <Card className="xl:sticky xl:top-4">
              <CardHeader title="Project summary" />
              <dl className="space-y-3 text-sm">
                {[['Name', w.name || '—'], ['Code', w.id || '—'], ['Client', w.client || '—'], ['Type', w.type], ['Timeline', w.start && w.end ? `${fmtDate(w.start)} – ${fmtDate(w.end)}` : '—'], ['Owner', w.owner], ['In-scope assets', String(inAssets.length)], ['Members', String(w.members.length + 1)]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="max-w-[60%] break-words text-right">{v}</dd></div>
                ))}
              </dl>
              <div className="mt-4 rounded-lg border border-dashed border-line p-3 text-xs text-muted">
                {isDirty ? 'Unsaved changes. Use "Save Draft" to create a draft project and return later.' : 'Fill in the required fields to continue.'}
              </div>
            </Card>
          </aside>
        )}
      </div>
    </>
  )
}
