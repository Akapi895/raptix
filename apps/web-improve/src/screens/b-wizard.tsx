import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check as CheckIcon, FileText, Lock, Plus, Trash2, Upload, X } from 'lucide-react'
import { useStore, useDirty, ROLE_LABEL, type ProjectDraft } from '../store'
import { USERS, type Role } from '../data'
import { Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, IconButton, Input, PageHeader, Select, Status, Tabs, Textarea, cx } from '../ui'

const TYPES = ['Red Team', 'Purple Team', 'Assessment']
const TZS: [string, string][] = [['UTC+07:00', 'Asia/Ho_Chi_Minh (UTC+7)'], ['UTC+00:00', 'UTC (UTC+0)']]
const LIMIT_PRESETS = [
  'No service disruption',
  'No access to real customer data',
  'Stop immediately on request from the emergency contact',
  'No destructive data techniques',
  'No denial-of-service attacks',
]
const ASSET_TYPES = ['Host', 'URL', 'Application', 'Subnet', 'Service']
const RANK: Record<Role, number> = { viewer: 1, analyst: 2, operator: 2, reviewer: 3, manager: 4, admin: 5 }
const ROLE_PERM: Record<Role, string> = { admin: 'Organization-wide administration', manager: 'Full control within the project', operator: 'Run operations, create findings', reviewer: 'Review and approve', analyst: 'Create findings and evidence', viewer: 'View only (no actions)' }
const STEP_NAMES = ['1. Basic Details', '2. Objectives', '3. Scope', '4. ROE & Approvals', '5. Review & Create']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return iso && y && m && d ? `${MON[+m - 1]} ${+d}, ${y}` : '' }

type W = Omit<ProjectDraft, 'start' | 'end'> & { start: string; end: string; success: string; sensitivity: string }

function nextId(ids: string[], type: string) {
  const pre = type === 'Purple Team' ? 'PT' : 'RT'
  const nums = ids.filter((i) => i.startsWith(pre + '-2026-')).map((i) => parseInt(i.slice(-3)) || 0)
  return `${pre}-2026-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`
}

export function ProjectNew() {
  const { db, me, go, A, toast } = useStore()
  const canCreate = me.role === 'admin' || me.role === 'manager'
  const init = useRef<W>({
    name: '', id: nextId(db.projects.map((p) => p.id), 'Red Team'), client: '', type: 'Red Team', desc: '', start: '2026-10-20', end: '2026-11-20', tz: 'UTC+07:00', owner: me.name, tags: [],
    goal: '', success: '', sensitivity: 'Synthetic / lab only', objectives: [{ text: '', criteria: '' }], metrics: '', unit: '', reportReq: '',
    scopeDesc: '', window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', limits: LIMIT_PRESETS.slice(0, 3), emergency: '', channel: '', roeFile: '', approver: 'Pat Kim',
    assets: [], members: [{ user: 'Pat Kim', role: 'reviewer' }],
  })
  const [w, setW] = useState<W>(init.current)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [show, setShow] = useState<Record<number, boolean>>({})
  const [idTouched, setIdTouched] = useState(false)
  const [tagIn, setTagIn] = useState('')
  const [scopeTab, setScopeTab] = useState('in')
  const [newAsset, setNewAsset] = useState({ name: '', ident: '', type: 'Host' })
  const [assetErr, setAssetErr] = useState('')
  const [customLimit, setCustomLimit] = useState('')
  const [checkRes, setCheckRes] = useState<string[] | null>(null)
  const [newMember, setNewMember] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const set = <K extends keyof W>(k: K, v: W[K]) => setW((s) => ({ ...s, [k]: v }))
  const isDirty = useMemo(() => JSON.stringify(w) !== JSON.stringify(init.current), [w])

  /* ───── validation ───── */
  const v0 = (x: W) => {
    const e: Record<string, string> = {}
    if (!x.name.trim()) e.name = 'Enter a project name.'
    if (!x.id.trim()) e.id = 'Enter a project code.'
    else if (!/^[A-Z]{2}-\d{4}-\d{3}$/.test(x.id)) e.id = 'Code must look like RT-2026-016.'
    else if (db.projects.some((p) => p.id === x.id)) e.id = `Code ${x.id} already exists. Use another code (suggested: ${nextId(db.projects.map((p) => p.id), x.type)}).`
    if (!x.client.trim()) e.client = 'Select or enter a client / organization.'
    if (!x.start) e.start = 'Choose a start date.'
    if (!x.end) e.end = 'Choose an end date.'
    else if (x.start && x.end < x.start) e.end = 'End date cannot be before the start date.'
    if (!x.owner) e.owner = 'Choose a primary owner.'
    return e
  }
  const v1 = (x: W) => {
    const e: Record<string, string> = {}
    if (!x.goal.trim()) e.goal = 'Enter the main objective of the project.'
    if (!x.objectives.some((o) => o.text.trim())) e.objectives = 'Add at least one specific objective.'
    return e
  }
  const v2 = (x: W) => {
    const e: Record<string, string> = {}
    if (!x.scopeDesc.trim()) e.scopeDesc = 'Describe the testing scope.'
    if (!x.window.trim()) e.window = 'Enter the permitted testing days and hours.'
    return e
  }
  const v3 = (x: W) => {
    const e: Record<string, string> = {}
    if (!x.approver) e.approver = 'Choose a requested reviewer.'
    else if (x.approver === x.owner) e.approver = 'The reviewer must be different from the owner.'
    else if (!x.members.some((m) => m.user === x.approver)) e.approver = 'The requested reviewer must be on the member list.'
    return e
  }
  const vs = [v0, v1, v2, v3]
  const errs = [v0(w), v1(w), v2(w), v3(w)]
  const bad = (i: number) => Object.keys(errs[i]).length > 0
  const E = (i: number) => (show[i] ? errs[i] : {}) as Record<string, string>

  const inAssets = w.assets.filter((a) => a.scope === 'in')
  const outAssets = w.assets.filter((a) => a.scope === 'out')
  const incompleteObj = w.objectives.filter((o) => (o.text.trim() && !o.criteria.trim()) || (!o.text.trim() && o.criteria.trim()))
  const submitIssues: { key: string; label: string; ok: boolean; level?: 'review'; detail: string; step: number }[] = [
    { key: 'info', label: 'Basic details are valid', ok: !bad(0), detail: bad(0) ? Object.values(errs[0])[0] : `${w.id} — ${w.client}`, step: 0 },
    { key: 'obj', label: 'Main and specific objectives', ok: !bad(1) && incompleteObj.length === 0, detail: bad(1) ? Object.values(errs[1])[0] : incompleteObj.length ? `${incompleteObj.length} objectives are missing text or criteria` : `${w.objectives.filter((o) => o.text.trim()).length} objectives`, step: 1 },
    { key: 'asset', label: 'At least one in-scope asset', ok: inAssets.length > 0, detail: inAssets.length ? `${inAssets.length} in scope, ${outAssets.length} out of scope` : 'No assets yet. You can save a draft but cannot submit for approval.', step: 2 },
    { key: 'window', label: 'Permitted assessment window', ok: !errs[2].window, detail: w.window || 'Not entered', step: 2 },
    { key: 'emerg', label: 'Emergency contact provided', ok: !!w.emergency.trim(), detail: w.emergency.trim() || 'Emergency contact missing. Required to submit for approval (PRE-09).', step: 2 },
    { key: 'file', label: 'ROE document attached', ok: !!w.roeFile, level: 'review', detail: w.roeFile || 'Not attached. The reviewer may request it.', step: 2 },
    { key: 'appr', label: 'Valid requested reviewer', ok: !bad(3), detail: bad(3) ? Object.values(errs[3])[0] : `${w.approver} is the requested reviewer`, step: 3 },
  ]
  const blocking = submitIssues.filter((i) => !i.ok && i.level !== 'review')
  const canSubmit = blocking.length === 0 && confirmed
  const minimalOk = !bad(0)

  /* ───── actions ───── */
  const create = (submit: boolean) => {
    if (saving || done) return
    if (!navigator.onLine) { setErr('Network connection lost. Your data is kept in the form. Try again when you are back online.'); return }
    if (bad(0)) { setShow((s) => ({ ...s, 0: true })); setStep(0); setErr('Basic details are not valid yet. Check the highlighted fields.'); return }
    if (submit && blocking.length) { setErr('Not ready to submit for approval: ' + blocking.map((b) => b.label).join('; ')); return }
    setErr(''); setSaving(true)
    const { success, sensitivity, ...rest } = w
    const draft: ProjectDraft = { ...rest, start: fmtDate(w.start), end: fmtDate(w.end), objectives: w.objectives.filter((o) => o.text.trim()), desc: [w.desc, w.goal && `Main objective: ${w.goal}`, success && `Success criteria: ${success}`, `Data sensitivity: ${sensitivity}`].filter(Boolean).join('\n') }
    const id = A.createProject(draft, submit)
    setDone(true)
    toast(submit ? `Created ${id} and submitted for approval` : `Saved draft ${id} with draft ${`ROE-${id.slice(-3)}-v1`}`)
    setTimeout(() => go('project', { id, tab: submit ? 'team' : 'overview' }), 80)
  }
  const saveDraft = () => {
    if (bad(0)) { setShow((s) => ({ ...s, 0: true })); setStep(0); toast('Complete a valid Step 1 before saving a draft.', 'warn'); return }
    create(false)
  }
  useDirty(isDirty && !done, saveDraft)

  const next = () => {
    setShow((s) => ({ ...s, [step]: true }))
    if (step < 4 && vs[step] && Object.keys(vs[step](w)).length) return
    const n = Math.min(4, step + 1)
    setStep(n); setMaxStep((m) => Math.max(m, n))
    document.querySelector('main')?.scrollTo?.(0, 0)
  }
  const jump = (i: number) => { if (i <= maxStep) { setShow((s) => ({ ...s, [step]: true })); setStep(i); document.querySelector('main')?.scrollTo?.(0, 0) } }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="Create Project" crumbs={[{ label: 'Projects', to: () => go('projects') }, { label: 'Create Project' }]} />
        <Empty icon={Lock} title="You do not have permission to create projects" action={<Button onClick={() => go('projects')}>Back to Projects</Button>}>
          Only a Red Team Manager or Organization Admin can create projects. Current role: {ROLE_LABEL[me.role]}.
        </Empty>
      </>
    )
  }

  const e0 = E(0), e1 = E(1), e2 = E(2), e3 = E(3)
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
  const AssetCards = ({ list, scope }: { list: W['assets']; scope: 'in' | 'out' }) =>
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
        {STEP_NAMES.map((s, i) => {
          const visited = i <= maxStep && i !== step
          const invalid = visited && i < 4 && bad(i) && show[i]
          const complete = visited && i < step && !invalid
          return (
            <li key={s} className="flex-1" style={{ minWidth: 150 }}>
              <button
                disabled={i > maxStep} onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}
                className={cx('flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition', i === step ? 'border-accent bg-accent/10 text-fg' : invalid ? 'border-bad/50 text-fg' : complete ? 'border-ok/40 text-fg hover:bg-hover' : 'border-line text-muted')}
              >
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', i === step ? 'bg-accent text-white' : invalid ? 'bg-bad text-white' : complete ? 'bg-ok text-white' : 'bg-hover')}>
                  {invalid ? '!' : complete ? <CheckIcon size={12} /> : i + 1}
                </span>
                <span className="font-medium">{s.slice(3)}</span>
                {invalid && <span className="ml-auto text-[11px] text-bad">Has errors</span>}
              </button>
            </li>
          )
        })}
      </ol>

      {err && <Banner tone="bad" title="Cannot create the project yet" action={<Button size="sm" variant="ghost" onClick={() => setErr('')}>Dismiss</Button>}>{err}</Banner>}

      <div className={cx('grid grid-cols-1 gap-5', step < 4 && 'xl:grid-cols-[minmax(0,1fr)_320px]')}>
        <div className="min-w-0">
          {/* ───── STEP 1 ───── */}
          {step === 0 && (
            <Card>
              <CardHeader title="Basic Details" sub="Fields marked * are required." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Project Name" required error={e0.name} className="md:col-span-2">
                  <Input value={w.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Internal Red Team Exercise Q1" aria-invalid={!!e0.name} />
                </Field>
                <Field label="Project Code" required error={e0.id} hint="Auto-suggested from the assessment type; checked for duplicates on create.">
                  <Input className="font-mono" value={w.id} onChange={(e) => { setIdTouched(true); set('id', e.target.value.toUpperCase()) }} aria-invalid={!!e0.id} />
                </Field>
                <Field label="Assessment Type" required>
                  <Select value={w.type} onChange={(e) => { const t = e.target.value; setW((s) => ({ ...s, type: t, id: idTouched ? s.id : nextId(db.projects.map((p) => p.id), t) })) }}>
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </Select>
                </Field>
                <Field label="Client" required error={e0.client} hint="Pick a suggestion or type a new name.">
                  <Input list="prj-clients" value={w.client} onChange={(e) => set('client', e.target.value)} placeholder="e.g. Example Corp A (Demo)" aria-invalid={!!e0.client} />
                  <datalist id="prj-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
                <Field label="Primary Owner" required error={e0.owner}>
                  <Select value={w.owner} onChange={(e) => set('owner', e.target.value)}>
                    {USERS.filter((u) => u.role === 'manager' || u.role === 'admin').map((u) => <option key={u.name}>{u.name}</option>)}
                  </Select>
                </Field>
                <Field label="Start Date" required error={e0.start}><Input type="date" value={w.start} onChange={(e) => set('start', e.target.value)} /></Field>
                <Field label="End Date" required error={e0.end}><Input type="date" value={w.end} min={w.start} onChange={(e) => set('end', e.target.value)} aria-invalid={!!e0.end} /></Field>
                <Field label="Time zone" required>
                  <Select value={w.tz} onChange={(e) => set('tz', e.target.value)}>{TZS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
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
                <Field label="Description" className="md:col-span-2"><Textarea value={w.desc} onChange={(e) => set('desc', e.target.value)} placeholder="Business context and overall scope of the engagement (synthetic data)." /></Field>
              </div>
            </Card>
          )}

          {/* ───── STEP 2 ───── */}
          {step === 1 && (
            <Card>
              <CardHeader title="Objectives" sub="Specific objectives are tracked in the project Overview and Team tabs." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Main Objective" required error={e1.goal} className="md:col-span-2">
                  <Textarea value={w.goal} onChange={(e) => set('goal', e.target.value)} placeholder="e.g. Assess SOC detection and response against an insider-threat scenario." aria-invalid={!!e1.goal} />
                </Field>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-medium">Specific objectives <span className="text-bad">*</span></div>
                  <Button size="sm" icon={Plus} onClick={() => set('objectives', [...w.objectives, { text: '', criteria: '' }])}>Add Objective</Button>
                </div>
                {e1.objectives && <div className="mb-2 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{e1.objectives}</div>}
                <ul className="space-y-2">
                  {w.objectives.map((o, i) => {
                    const warn = (o.text.trim() && !o.criteria.trim()) || (!o.text.trim() && o.criteria.trim())
                    const upd = (patch: Partial<typeof o>) => set('objectives', w.objectives.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                    const mv = (d: number) => { const a = [...w.objectives]; const t = a[i]; a[i] = a[i + d]; a[i + d] = t; set('objectives', a) }
                    return (
                      <li key={i} className={cx('rounded-lg border p-3', warn ? 'border-warn/40' : 'border-line')}>
                        <div className="flex items-start gap-3">
                          <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold">{i + 1}</span>
                          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
                            <Input aria-label={`Objective ${i + 1}`} value={o.text} onChange={(e) => upd({ text: e.target.value })} placeholder="Specific objective" />
                            <Input aria-label={`Success criterion ${i + 1}`} value={o.criteria} onChange={(e) => upd({ criteria: e.target.value })} placeholder="Measurable success criterion" />
                          </div>
                          <div className="flex shrink-0">
                            <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => mv(-1)} />
                            <IconButton icon={ArrowDown} label="Move down" disabled={i === w.objectives.length - 1} onClick={() => mv(1)} />
                            <IconButton icon={Trash2} label="Remove objective" disabled={w.objectives.length === 1} onClick={() => set('objectives', w.objectives.filter((_, j) => j !== i))} />
                          </div>
                        </div>
                        {warn && <div className="mt-2 pl-9 text-xs text-warn">Incomplete objective: both the objective and its success criterion are needed.</div>}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Success Criteria"><Textarea value={w.success} onChange={(e) => set('success', e.target.value)} placeholder="e.g. 80% or more of techniques have detection data." /></Field>
                <Field label="Assumptions & Metrics"><Textarea value={w.metrics} onChange={(e) => set('metrics', e.target.value)} placeholder="e.g. Mean time to detect, coverage rate." /></Field>
                <Field label="Business Context"><Input value={w.unit} onChange={(e) => set('unit', e.target.value)} placeholder="e.g. SOC, Infrastructure team" /></Field>
                <Field label="Reporting Requirements"><Textarea value={w.reportReq} onChange={(e) => set('reportReq', e.target.value)} placeholder="e.g. Executive summary plus technical appendix." /></Field>
              </div>
            </Card>
          )}

          {/* ───── STEP 3 ───── */}
          {step === 2 && (
            <Card>
              <CardHeader title="Scope" sub="Assets can be added after saving a draft. Submitting for approval needs in-scope assets, an assessment window and an emergency contact."
                actions={<Button size="sm" onClick={runCheck}>Check Scope</Button>} />
              <Field label="Scope Description & Boundaries" required error={e2.scopeDesc} className="mb-4">
                <Textarea value={w.scopeDesc} onChange={(e) => set('scopeDesc', e.target.value)} placeholder="e.g. Lab environment with 3 web/API/Windows servers; the restricted zone is excluded." aria-invalid={!!e2.scopeDesc} />
              </Field>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Assessment Window" required error={e2.window} className=""><Input value={w.window} onChange={(e) => set('window', e.target.value)} aria-invalid={!!e2.window} /></Field>
                <Field label="Data Sensitivity"><Select value={w.sensitivity} onChange={(e) => set('sensitivity', e.target.value)}>{['Synthetic / lab only', 'Internal', 'Confidential'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
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

          {/* ───── STEP 4 ───── */}
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
                    <Input value={w.emergency} onChange={(e) => set('emergency', e.target.value)} placeholder="Full name, phone (synthetic)" />
                  </Field>
                  <Field label="Approval Contacts / Incident Channel"><Input value={w.channel} onChange={(e) => set('channel', e.target.value)} placeholder="e.g. 24/7 SOC channel (synthetic)" /></Field>
                  <Field label="Requested Reviewer">
                    <Select value={w.approver} onChange={(e) => { const u = e.target.value; setW((x) => ({ ...x, approver: u, members: x.members.some((m) => m.user === u) ? x.members : [...x.members, { user: u, role: USERS.find((y) => y.name === u)!.role }] })) }}>{USERS.filter((u) => u.role === 'reviewer' || u.role === 'admin').map((u) => <option key={u.name}>{u.name}</option>)}</Select>
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
                            <Select aria-label={`Role of ${m.user}`} className="!h-9 min-w-44" value={m.role} onChange={(e) => { const role = e.target.value as Role; setW((s) => ({ ...s, members: s.members.map((x) => (x.user === m.user ? { ...x, role } : x)), approver: s.approver === m.user && role !== 'reviewer' && role !== 'admin' ? '' : s.approver })) }}>
                              {(Object.keys(RANK) as Role[]).map((r) => <option key={r} value={r} disabled={!assignable.includes(r)}>{ROLE_LABEL[r]}{!assignable.includes(r) ? ' (above your role)' : ''}</option>)}
                            </Select>
                          </td>
                          <td className="px-4 text-muted">{ROLE_PERM[m.role]}</td>
                          <td className="px-4"><Status kind="generic" value="neutral" size="sm" label="Will be invited" /></td>
                          <td className="px-4">
                            <label className={cx('inline-flex items-center gap-2 text-xs', !canApprove && 'opacity-40')}>
                              <input type="radio" name="approver" disabled={!canApprove} checked={w.approver === m.user} onChange={() => set('approver', m.user)} className="accent-[var(--c-accent)]" />
                              {w.approver === m.user ? 'Selected' : 'Select'}
                            </label>
                          </td>
                          <td><IconButton icon={Trash2} label={`Remove ${m.user}`} onClick={() => setW((s) => ({ ...s, members: s.members.filter((x) => x.user !== m.user), approver: s.approver === m.user ? '' : s.approver }))} /></td>
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
                  setW((s) => ({ ...s, members: [...s.members, { user: u.name, role }], approver: s.approver || (role === 'reviewer' ? u.name : '') }))
                  setNewMember('')
                }}>Add Member</Button>
              </div>
              {candidates.length === 0 && <div className="mt-2 text-xs text-muted">All organization accounts have been added.</div>}
            </Card>
            </div>
          )}

          {/* ───── STEP 5 ───── */}
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
                    {w.members.map((m) => <li key={m.user}>{m.user} — {ROLE_LABEL[m.role]}{w.approver === m.user && <span className="ml-2 text-xs text-accent">Requested reviewer</span>}</li>)}
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
                    <Button className="w-full" disabled={saving} onClick={() => create(false)} title={minimalOk ? 'Save as a draft project' : 'Opens Step 1 to complete the name, client, dates and owner'}>{saving ? 'Saving…' : 'Create Draft'}</Button>
                  </div>
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Outcome 2 — Submit for Approval</div>
                    <p className="mb-2 mt-1 text-xs text-muted">Sends the ROE to the reviewer. Submitting does not approve it; a reviewer must decide.</p>
                    <Check checked={confirmed} onChange={setConfirmed} label="I confirm the scope and ROE above are accurate. This does not replace the reviewer's approval." />
                    <Button variant="primary" className="mt-3 w-full" disabled={!canSubmit || saving} onClick={() => create(true)} title={canSubmit ? undefined : blocking.length ? `Not ready: ${blocking[0].label}` : 'Tick the scope confirmation first'}>Submit for Approval</Button>
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
              {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
              <Button onClick={saveDraft} disabled={saving} title="Create the project as a Draft with the data entered so far">Save Draft</Button>
              {step < 4 && <Button variant="primary" onClick={next}>Next</Button>}
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
