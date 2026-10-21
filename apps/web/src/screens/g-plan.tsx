import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Plus, Rocket, Trash2, XCircle } from 'lucide-react'
import { useDirty } from '../state/session'
import { useServices } from '../state/services'
import { planVer } from '../domain/catalog';
import type { Plan, PlanStep } from '../domain/entities'
import type { Chk } from '../features/plans/policy'
import {
  decidePlanTransaction, discardPlanTransaction, editPlanDraftTransaction, effectivePlanStatus, requestPlanReviewTransaction,
  revisePlanTransaction, withdrawPlanReviewTransaction,
} from '../features/plans/service'
import { createOperationFromPlanTransaction, readPlanProject } from '../features/plans/bridge'
import { readPlanChecksNow, usePlanChecks, usePlanView, useProjectPlans, type PlanView } from '../features/plans/projection'
import { PlanCompareError, usePlanCompare } from '../features/plans/compare'
import { readActor } from '../auth/identity'
import { go, selectProject, useRoute } from '../router/navigate'
import { useAccessible, useCan, useMe, useReadOnly } from '../state/console'
import { useAuthStore, useProjectStore, useToastStore } from '../state/stores'
import type { ConsoleServices } from '../domain/console-services';
import { ApprovalBanner, Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, Gated, IdLink, Input, Modal, PageHeader, Select, Status, Table, Tabs, Textarea, Check, Mono, cx } from '../ui/index'
import { NoProject, ReplanPanel, tz, useReplan } from '../features/aichat'
import { FanOutCard } from '../features/branches'

/* The legacy Res bridge shape (the store's private `Res`). */
type Res = { ok: boolean; error?: string }

/* Ticket 67 wave 7: the store's request context (actorCtx), mirrored — the
   persona resolves at call time through the identity service (the
   override-aware `me`, read from the authorities so a failing authority read
   never reaches this render) with corr 'legacy'. */
function actorCtxOf(services: ConsoleServices, projectId: string) {
  return { actor: readActor(services, useAuthStore.getState().meName), projectId, corr: 'legacy' }
}

/* Ticket 67 wave 7: the legacy A.* plan-workbench entries, mirrored — each
   addressed plan's project binding resolves through the typed plans bridge
   at call time (same `Plan <id> does not exist.` copy), the request context
   carries the override-aware persona with corr 'legacy', and the typed
   results bridge back to the legacy shapes. */
function usePlanActions() {
  const services = useServices()
  const planProjectOf = (planId: string) => readPlanProject(services.authority, planId)
  return {
    requestApproval: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = requestPlanReviewTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    decide: (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = decidePlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, decision, note)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    withdraw: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = withdrawPlanReviewTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    revise: (planId: string, changes: string[], note?: string): string => {
      const projectId = planProjectOf(planId)
      if (!projectId) return ''
      const res = revisePlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, changes, note)
      return res.ok ? res.data.planId : ''
    },
    editDraft: (planId: string, patch: { steps?: Plan['steps']; title?: string }): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = editPlanDraftTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId, patch)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    discard: (planId: string): Res => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = discardPlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true } : { ok: false, error: res.failure.message }
    },
    execute: (planId: string): { ok: boolean; opId?: string; error?: string } => {
      const projectId = planProjectOf(planId)
      if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
      const res = createOperationFromPlanTransaction(services.authority, services.clock, actorCtxOf(services, projectId), planId)
      return res.ok ? { ok: true, opId: res.data.opId } : { ok: false, error: res.failure.message }
    },
  }
}

/** Breadcrumb: AI Operator > conversation > plan > leaf. */
function useCrumbs(plan: Plan, leaf?: string) {
  const c = [
    { label: 'AI Operator', to: () => go('ai-operator') },
    { label: plan.conversationId, to: () => go('ai-operator', { id: plan.conversationId }) },
    { label: `${plan.id} ${planVer(plan)}`, to: leaf ? () => go('ai-plan', { id: plan.id }) : undefined },
  ]
  if (leaf) c.push({ label: leaf, to: undefined })
  return c
}

/* Ticket 42: the revision-diff derivation (stepDiff/reapprovalNotes) moved to
   the plans feature (src/features/plans/compare.ts) — the compare surfaces
   read the derived diff through the typed service instead of the database.
   Ticket 67: the plan's linked records and version chain assemble in the
   plans feature's typed PlanView (src/features/plans/projection.ts). */

function StepDrawer({ plan, stepId, onClose }: { plan: Plan; stepId?: string; onClose: () => void }) {
  const pv = usePlanView(plan.id)
  if (!pv) return null
  const s = plan.steps.find((x) => x.id === stepId)
  const i = s ? plan.steps.findIndex((x) => x.id === s.id) : -1
  const op = pv.op
  const ops = s && op ? op.steps.find((x) => x.id === s.id) : undefined
  const group = pv.branchGroups.find((g) => g.planId === plan.id)
  const branches = s && group ? pv.branches.filter((b) => b.groupId === group.id && b.stepId === s.id) : []
  const tools = s && plan.opId ? pv.toolEvents.filter((t) => t.opId === plan.opId && t.stepId === s.id) : []
  return (
    <Drawer open={!!s} onClose={onClose} title={s ? <span><Mono>{s.id}</Mono> {s.name}</span> : 'Step'} width={520}
      footer={<><Button disabled={i <= 0} title={i <= 0 ? 'This is the first step.' : undefined} onClick={() => go('ai-plan', { id: plan.id, tab: `step-${plan.steps[i - 1].id}` })}>Previous step</Button><Button disabled={i < 0 || i >= plan.steps.length - 1} title={i >= plan.steps.length - 1 ? 'This is the last step.' : undefined} onClick={() => go('ai-plan', { id: plan.id, tab: `step-${plan.steps[i + 1].id}` })}>Next step</Button><Button onClick={onClose}>Close</Button></>}>
      {s && (
        <div className="space-y-4">
          <p className="text-xs text-muted">Read-only view of {plan.id} {planVer(plan)} ({plan.status.replace('_', ' ')}). Step content is plain-language; nothing here is executed.</p>
          <DescList cols={1} items={detailOf(s, plan.steps, pv)} />
          <ApprovalImpact s={s} plan={plan} />
          {ops && <p className="text-sm">Runtime state in <IdLink onClick={() => go('operation', { id: op!.id })}>{op!.id}</IdLink>: <Status kind="step" value={ops.status} size="sm" /></p>}
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Branches for this step</h4>
            {branches.length === 0 ? <p className="text-sm text-muted">No branches for this step.</p> : <ul className="space-y-1 text-sm">{branches.map((b) => <li key={b.id}><IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink> · {b.target} · {b.state.replace('_', ' ')}</li>)}</ul>}
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Tool events</h4>
            {tools.length === 0 ? <p className="text-sm text-muted">No tool events recorded for this step.</p> : <ul className="space-y-1 text-sm">{tools.map((t) => <li key={t.id}><IdLink onClick={() => go('ai-trace', { id: t.id })}>{t.id}</IdLink> · {t.tool} · {t.state}</li>)}</ul>}
          </div>
        </div>
      )}
    </Drawer>
  )
}

const RISK_CLS = { low: 'text-ok', medium: 'text-warn', high: 'text-bad' }
const Risk = ({ v }: { v: PlanStep['risk'] }) => <span className={cx('font-medium capitalize', RISK_CLS[v])}>{v}</span>

/* Ticket 67 wave 7: the legacy store reads leave the context — the console
   read seam (pid/accessible), the router module (route/go + the guarded
   selectProject for the store's setPid) and the plans feature's typed views
   (PlanView per route plan, the selected project's plan list) project the
   same derivations. */
// eslint-disable-next-line react-refresh/only-export-components -- plan screen module: helper co-exported with screens
export function usePlan() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const accessible = useAccessible()
  const view = usePlanView(route.id ?? '')
  const list = useProjectPlans(pid)
  return { route, pid, go, setPid: selectProject, accessible, plan: view?.plan, foreign: !!view?.plan && pid !== 'all' && view.plan.projectId !== pid, plans: list.plans }
}

function PlanGuard({ children, title }: { children: (plan: Plan) => React.ReactNode; title: string }) {
  const { plan, foreign, plans, pid, go, route, setPid, accessible } = usePlan()
  if (!route.id) {
    if (pid === 'all') return <><PageHeader title={title} /><NoProject /></>
    const list = plans
    return (
      <>
        <PageHeader title={title} sub="Choose a plan." />
        <Table rows={list} rowKey={(p) => p.id} onRow={(p) => go(route.page, { id: p.id })}
          empty={<Empty title="No plans for this project yet" action={<Button variant="primary" onClick={() => go('ai-operator')}>Open AI Operator</Button>}>Ask the AI to propose a plan in Propose mode.</Empty>}
          cols={[
            { key: 'id', header: 'Plan', render: (p) => <Mono>{p.id}</Mono> },
            { key: 't', header: 'Title', render: (p) => p.title },
            { key: 'v', header: 'Version', render: (p) => `${planVer(p)}` },
            { key: 's', header: 'Status', render: (p) => <Status kind="plan" value={p.status} /> },
          ]} />
      </>
    )
  }
  if (!plan) return <><PageHeader title={title} /><Empty title="Plan not found" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>{route.id} does not exist or was removed.</Empty></>
  if (foreign) {
    const can = accessible.some((p) => p.id === plan.projectId)
    return <><PageHeader title={title} /><Empty title="This plan belongs to another project" action={can ? <Button variant="primary" onClick={() => setPid(plan.projectId)}>Switch to {plan.projectId}</Button> : undefined}>{plan.id} is outside the selected project ({pid}). Plans are isolated per project.</Empty></>
  }
  return <>{children(plan)}</>
}

function approvalState(p: Plan) {
  return p.status === 'approved' || p.status === 'executed' ? 'approved' : p.status === 'in_review' ? 'waiting' : p.status === 'rejected' ? 'rejected' : p.status === 'expired' ? 'expired' : 'none'
}

function Validation({ plan }: { plan: Plan }) {
  const pv = usePlanView(plan.id)
  if (!pv) return null
  const p = pv.project
  const agents = plan.agents.map((a) => pv.agentOf(a))
  const assets = plan.assets.map((a) => pv.assetOf(a))
  const checks = [
    { ok: p.roeStatus === 'approved', t: `ROE approved (${p.roeVersion} is ${p.roeStatus})` },
    { ok: plan.roeVersion === p.roeVersion, t: `Plan pinned to ${plan.roeVersion}; project is on ${p.roeVersion}` },
    { ok: assets.every((a) => a?.scope === 'in'), t: 'All target assets are in scope' },
    { ok: agents.every((a) => a?.status === 'online'), t: 'All assigned agents are online' },
  ]
  const passed = checks.filter((c) => c.ok).length
  return (
    <Card>
      <CardHeader title="Validation" sub={`${passed} of ${checks.length} prerequisites passed`} />
      <ul className="space-y-1.5 text-sm">
        {checks.map((c) => <li key={c.t} className="flex items-start gap-2">{c.ok ? <CheckCircle2 size={16} className="mt-0.5 text-ok" aria-label="Passed" /> : <XCircle size={16} className="mt-0.5 text-bad" aria-label="Failed" />}{c.t}</li>)}
        {plan.steps.some((s) => s.needsApproval) && <li className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 text-warn" aria-hidden />{plan.steps.filter((s) => s.needsApproval).length} step(s) need action-specific approval.</li>}
      </ul>
    </Card>
  )
}

function ReviseDialog({ plan, open, onClose }: { plan: Plan; open: boolean; onClose: () => void }) {
  const actions = usePlanActions()
  const toast = useToastStore((s) => s.toast)
  const [changes, setChanges] = useState<string[]>([''])
  const [note, setNote] = useState('')
  const set = (i: number, v: string) => setChanges((c) => c.map((x, j) => (j === i ? v : x)))
  const list = changes.map((c) => c.trim()).filter(Boolean)
  const gated = plan.status === 'approved' || plan.status === 'executed'
  const submit = () => {
    const id = actions.revise(plan.id, list, note)
    if (!id) { toast('The revision could not be created — the plan must be approved and at least one change described.', 'bad'); return }
    toast(`Revision ${id} created. Re-approval required.`, 'warn')
    onClose(); setChanges(['']); setNote('')
    go('ai-plan-compare', { id })
  }
  return (
    <Modal open={open} onClose={onClose} title={`Revise ${plan.id}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={list.length === 0} title={list.length === 0 ? 'Add at least one change.' : undefined} onClick={submit}>Create revision</Button></>}>
      <div className="space-y-4">
        <Banner tone="warn" title="Re-approval required">{gated ? `${plan.id} is approved and will not be modified. ` : ''}The revision becomes a new draft version ({(() => { const m = planVer(plan).match(/^v(\d+)\.(\d+)$/); return m ? `v${m[1]}.${+m[2] + 1}` : `v${plan.version + 1}` })()}) that must be approved again. {plan.id} stays {plan.status} and unchanged{plan.opId ? `; ${plan.opId} keeps using ${plan.id} ${planVer(plan)} until you explicitly switch it` : ''}. Changes to scope, tools, targets, risk or concurrency require re-approval.</Banner>
        <Field label="Requested changes" hint="Describe each change in plain language. Example: Add approval gate to step P05.">
          <div className="space-y-2">
            {changes.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Change ${i + 1}`} value={c} onChange={(e) => set(i, e.target.value)} placeholder="Add approval gate to ..." />
                <Button variant="ghost" aria-label={`Remove change ${i + 1}`} disabled={changes.length === 1} title={changes.length === 1 ? 'At least one change row is required.' : undefined} icon={Trash2} onClick={() => setChanges((x) => x.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button size="sm" icon={Plus} onClick={() => setChanges((x) => [...x, ''])}>Add change</Button>
          </div>
        </Field>
        <Field label="Note for reviewer (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function Builder({ plan, onRevise, request }: { plan: Plan; onRevise: () => void; request: React.ReactNode }) {
  const services = useServices()
  const actions = usePlanActions()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const readOnly = useReadOnly()
  const pv = usePlanView(plan.id)
  const editable = (plan.status === 'draft' || plan.status === 'proposed') && !readOnly(plan.projectId)
  const canPlan = can('plan')
  const [edit, setEdit] = useState(false)
  const [reorder, setReorder] = useState(false)
  const [steps, setSteps] = useState<PlanStep[]>(plan.steps)
  const [sel, setSel] = useState<string | undefined>(plan.steps[0]?.id)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [discard, setDiscard] = useState(false)
  useEffect(() => { if (!edit) setSteps(plan.steps) }, [plan.steps, edit])
  const dirty = edit && JSON.stringify(steps) !== JSON.stringify(plan.steps)
  const save = () => { const r = actions.editDraft(plan.id, { steps }); if (!r.ok) { toast(r.error || 'The draft could not be saved.', 'bad'); return }; setEdit(false); setReorder(false); toast(`${plan.id} saved as ${plan.status}. Not submitted for review.`, 'ok') }
  useDirty(dirty, save)
  if (!pv) return null
  const view: Plan = { ...plan, steps }
  const step = steps.find((x) => x.id === sel) || steps[0]
  const upd = (id: string, patch: Partial<PlanStep>) => setSteps((x) => x.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const move = (id: string, d: -1 | 1) => setSteps((x) => { const i = x.findIndex((s) => s.id === id); const j = i + d; if (i < 0 || j < 0 || j >= x.length) return x; const c = [...x]; [c[i], c[j]] = [c[j], c[i]]; return c })
  const remove = (id: string) => setSteps((x) => x.filter((s) => s.id !== id))
  const add = () => {
    const last = steps[steps.length - 1]
    const m = last?.id.match(/^(\D*)(\d+)$/)
    const id = m ? m[1] + String(+m[2] + 1).padStart(m[2].length, '0') : 'N' + (steps.length + 1)
    const n: PlanStep = { phase: step?.phase || last?.phase, id, name: 'New step (describe goal)', technique: last?.technique || 'T1082', asset: step?.asset || last?.asset || '', agent: plan.agents[0] || '', tool: last?.tool || 'host-info-collector', risk: 'low', needsApproval: false, rationale: 'Added by operator in draft.' }
    setSteps((x) => [...x, n]); setSel(id)
  }
  const validate = () => {
    /* Ticket 67: the validation read re-derives the policy checks for the
       edited version from current state at click time. */
    const f = readPlanChecksNow(services, view).filter((c) => c.state === 'fail')
    setMsg(f.length ? { ok: false, t: `Scope validation failed: ${f.map((c) => `${c.label} — ${c.detail}`).join(' ')}` } : { ok: true, t: 'Scope validation passed: all targets and agents are within the approved ROE. (Simulated check)' })
  }
  const tip = !canPlan ? 'Your role cannot edit plans.' : !editable ? 'Approved or in-review plans are frozen. Use “Revise” to create a new version.' : ''
  const needEdit = !edit ? 'Click Edit Draft first.' : ''
  const impact = steps.filter((s) => s.needsApproval).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2">
        {editable ? (
          <Gated allowed={!tip} reason={tip}><Button variant={edit ? undefined : 'primary'} onClick={() => { setEdit(!edit); setReorder(false) }} aria-pressed={edit}>{edit ? 'Stop editing' : 'Edit Draft'}</Button></Gated>
        ) : (
          <Gated allowed={canPlan && !readOnly(plan.projectId) && ['approved', 'executed'].includes(plan.status)} reason={!canPlan ? 'Your role cannot revise plans.' : plan.status === 'in_review' ? 'Plan is in review; the reviewer decides first.' : 'This plan cannot be revised in its current status.'}><Button variant="primary" onClick={onRevise}>Revise (new version)</Button></Gated>
        )}
        <Gated allowed={edit} reason={needEdit || tip}><Button icon={Plus} onClick={add}>Add Step</Button></Gated>
        <Gated allowed={edit} reason={needEdit || tip}><Button onClick={() => setReorder(!reorder)} aria-pressed={reorder}>Reorder</Button></Gated>
        <Button onClick={validate}>Validate Scope</Button>
        <Gated allowed={dirty} reason={!edit ? 'Nothing to save — click Edit Draft first.' : 'No changes to save.'}><Button onClick={save}>Save Plan</Button></Gated>
        {request}
        <Gated allowed={editable && canPlan} reason={tip}><Button variant="danger" onClick={() => setDiscard(true)}>Discard Draft</Button></Gated>
      </div>
      {!editable && ['approved', 'executed', 'in_review'].includes(plan.status) && <Banner tone="info" title="Guarded plan">Changing scope or steps of a {plan.status === 'in_review' ? 'plan in review' : 'approved plan'} creates a new revision that must be approved again. A started operation stays pinned to the approved version.</Banner>}
      {msg && <Banner tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Scope valid' : 'Scope problem'}>{msg.t}</Banner>}
      {dirty && <p className="text-xs text-warn">Unsaved changes in {plan.id} — Save Plan to keep them as a draft.</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,340px)]">
        <Card><CardHeader title="Goal & steps" sub={plan.rationale.length > 90 ? plan.rationale.slice(0, 88) + '…' : plan.rationale} />
          {steps.length === 0 ? <p className="text-sm text-muted">No steps. Use Add Step to build the plan.</p> : <StepGroups plan={view} steps={steps} sel={step?.id} onSel={setSel} edit={edit && reorder} move={move} remove={remove} />}
        </Card>
        <Card>
          {!step ? <Empty title="No step selected">Add a step to edit its details.</Empty> : edit ? (
            <div className="space-y-3">
              <CardHeader title={<><Mono>{step.id}</Mono> Edit step</>} sub="Plain-English goal; no commands or payloads." />
              <Field label="Goal"><Input value={step.name} onChange={(e) => upd(step.id, { name: e.target.value })} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Risk class"><Select value={step.risk} onChange={(e) => upd(step.id, { risk: e.target.value as PlanStep['risk'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Field>
                <Field label="Assigned agent"><Select value={step.agent} onChange={(e) => upd(step.id, { agent: e.target.value })}>{plan.agents.map((a) => <option key={a} value={a}>{a}</option>)}</Select></Field>
                <Field label="Allowed asset"><Select value={step.asset} onChange={(e) => upd(step.id, { asset: e.target.value })}>{[...new Set([...steps.map((s) => s.asset), ...plan.assets.map((a) => pv.assetOf(a)?.name || a)])].map((a) => <option key={a} value={a}>{a}</option>)}</Select></Field>
              </div>
              <Check checked={step.needsApproval} onChange={(v) => upd(step.id, { needsApproval: v })} label="Require explicit approval gate for this step" />
            </div>
          ) : (
            <><CardHeader title={<><Mono>{step.id}</Mono> {step.name}</>} sub={step.phase} /><DescList cols={2} items={detailOf(step, steps, pv)} /><div className="mt-3"><ApprovalImpact s={step} plan={view} /></div><div className="mt-2"><Button size="sm" disabled={dirty} title={dirty ? 'Save the draft first.' : undefined} onClick={() => go('ai-plan', { id: plan.id, tab: `step-${step.id}` })}>Open step detail</Button></div></>
          )}
        </Card>
        <div className="space-y-4">
          <Card><CardHeader title="Risk, scope & approval" />
            <DescList cols={1} items={[
              { k: 'Steps / phases', v: `${steps.length} / ${phasesOf(steps).length}` }, { k: 'Risk mix', v: `${steps.filter((s) => s.risk === 'low').length} low · ${steps.filter((s) => s.risk === 'medium').length} medium · ${steps.filter((s) => s.risk === 'high').length} high` },
              { k: 'Approval gates', v: impact }, { k: 'ROE / window', v: `${plan.roeVersion} · ${pv.project.window}` },
              { k: 'Approval', v: plan.status === 'in_review' ? `Waiting for ${plan.reviewer}` : plan.decision ? `${plan.decision.by} · ${tz(plan.decision.at)}` : 'Not requested' }, { k: 'Expiry', v: plan.expires ? tz(plan.expires) : '—' },
            ]} />
            <div className="mt-2"><Button size="sm" onClick={() => go('ai-plan-review', { id: plan.id })}>Open approval review</Button></div>
          </Card>
          <PolicyChecks plan={view} />
        </div>
      </div>
      <Modal open={discard} onClose={() => setDiscard(false)} title={`Discard ${plan.id}?`} danger footer={<><Button onClick={() => setDiscard(false)}>Keep draft</Button><Button variant="danger" onClick={() => { const r = actions.discard(plan.id); setDiscard(false); if (r.ok) { toast(`${plan.id} discarded.`, 'warn'); go('ai-operator', { id: plan.conversationId }) } else toast(r.error || 'The draft could not be discarded.', 'bad') }}>Discard draft</Button></>}>
        <p className="text-sm">The draft and its chat card are removed. This cannot be undone; approved plans are never discarded.</p>
      </Modal>
    </div>
  )
}

export function AiPlan() {
  return <PlanGuard title="Proposed Plan">{(plan) => <PlanDetail plan={plan} />}</PlanGuard>
}

function PlanDetail({ plan }: { plan: Plan }) {
  const pv = usePlanView(plan.id)
  const route = useRoute()
  const actions = usePlanActions()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const readOnly = useReadOnly()
  const deepStep = route.tab?.startsWith('step-') ? route.tab.slice(5) : undefined
  const [tab, setTab] = useState(deepStep ? 'steps' : route.tab && ['builder', 'overview', 'steps', 'branches', 'assets', 'risk', 'refs', 'history'].includes(route.tab) ? route.tab : plan.status === 'draft' || plan.status === 'proposed' ? 'builder' : 'overview')
  const [stepId, setStepId] = useState<string | undefined>(deepStep)
  useEffect(() => { if (route.tab?.startsWith('step-')) { setStepId(route.tab.slice(5)); setTab('steps') } }, [route.tab])
  const [revise, setRevise] = useState(false)
  const replan = useReplan(plan.projectId)
  const crumbs = useCrumbs(plan)
  if (!pv) return null
  const p = pv.project
  const ro = readOnly(plan.projectId)
  const next = pv.next
  const history = pv.chain
  const op = pv.op
  const prevPlan = pv.prev
  const isRevision = !!prevPlan
  const readOnlyPlan = ['superseded', 'rejected', 'expired'].includes(plan.status)
  const fwd = plan.status === 'superseded' ? [...history].reverse().find((x) => x.id !== plan.id && x.version > plan.version) : undefined
  const reviseOk = plan.status === 'approved' || plan.status === 'executed'
  const openDraft = next && ['draft', 'proposed', 'in_review'].includes(next.status) ? next : undefined
  const groups = pv.branchGroups.filter((g) => g.planId === plan.id)
  const sibling = groups.length === 0 ? pv.branchGroups.find((g) => history.some((h) => h.id === g.planId)) : undefined
  const canPlan = can('plan') && !ro
  const whyPlan = ro ? 'This project is read-only.' : 'Your role cannot request plan approval. Ask a Red Team Operator or Lead.'
  const proposal = plan.status === 'proposed' || plan.status === 'draft'
  const roeBlocked = p.roeStatus !== 'approved'
  const reqWhy = !proposal ? `Review can only be requested for a draft or proposed plan (this one is ${plan.status.replace('_', ' ')}).` : roeBlocked ? `Cannot request approval: ${p.roeVersion} is ${p.roeStatus === 'none' ? 'missing' : p.roeStatus}. The plan can still be saved as a draft.` : !canPlan ? whyPlan : ''
  const request = (
    <span className="inline-flex items-center gap-2">
      <Gated allowed={!reqWhy} reason={reqWhy}><Button variant="primary" onClick={() => { const r = actions.requestApproval(plan.id); if (r.ok) toast(`${plan.id} ${planVer(plan)} sent to ${plan.reviewer} for review.`, 'ok'); else toast(r.error || 'The review request could not be recorded.', 'bad') }}>Request Review</Button></Gated>
      {roeBlocked && proposal && <button className="text-xs text-accent hover:underline" onClick={() => go('project', { id: p.id, tab: 'scope' })}>Fix ROE →</button>}
    </span>
  )
  return (
    <>
      <PageHeader crumbs={crumbs} title="Proposed Plan"
        meta={<><Mono>{plan.id}</Mono><span className="text-sm text-muted">{planVer(plan)}</span><Status kind="plan" value={plan.status} />{op && op.planId === plan.id && <span className="whitespace-nowrap rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-xs text-accent">Used by {op.id}</span>}</>}
        sub={<>{plan.title} · {plan.projectId} · Owner {plan.requestedBy} · Model raptix-ai-demo-1 · Created {plan.created}</>}
        actions={<>
          <Gated allowed={canPlan && reviseOk && !openDraft} reason={!canPlan ? whyPlan : openDraft ? `${openDraft.id} ${planVer(openDraft)} is already an open ${openDraft.status.replace('_', ' ')} revision. Open it instead.` : `Only an approved plan can be revised (this one is ${plan.status.replace('_', ' ')}). ${proposal ? 'Edit the draft directly.' : 'Open the latest version.'}`}><Button onClick={() => setRevise(true)}>Create Revision</Button></Gated>
          <Button disabled={!plan.prevPlanId && !next} title={!plan.prevPlanId && !next ? 'This plan has no other revision to compare.' : undefined} onClick={() => go('ai-plan-compare', { id: plan.id })}>Compare Revision</Button>
          <Button onClick={() => go('ai-plan-review', { id: plan.id })}>Approval Review</Button>
          {op && op.planId === plan.id
            ? <Button icon={Rocket} onClick={() => go('operation', { id: op.id })}>Open {op.id}</Button>
            : <Gated allowed={plan.status === 'approved' && can('run')} reason={plan.status !== 'approved' ? 'Create Operation is disabled until the plan is Approved.' : 'Your role cannot create operations.'}>
              <Button icon={Rocket} onClick={() => go('ai-plan-review', { id: plan.id })}>Create Operation</Button>
            </Gated>}
        </>} />
      <div className="mb-4 space-y-3">
        {readOnlyPlan && <Banner tone="info" title={`${plan.id} ${planVer(plan)} is ${plan.status} — read-only`} action={fwd ? <Button size="sm" onClick={() => go('ai-plan', { id: fwd.id })}>Open {fwd.id} {planVer(fwd)}</Button> : undefined}>{plan.status === 'superseded' ? `This version was replaced${fwd ? ` by ${fwd.id} ${planVer(fwd)}` : ''}. It is kept for audit and cannot be edited, approved or executed.` : 'This version is closed and cannot be edited or executed. Start a new plan from the conversation.'}</Banner>}
        {isRevision && prevPlan && <Banner tone="warn" title={`Revision of ${prevPlan.id} ${planVer(prevPlan)}`} action={<Button size="sm" onClick={() => go('ai-plan-compare', { id: plan.id })}>View diff</Button>}>{prevPlan.id} stays {prevPlan.status.replace('_', ' ')} and unchanged{prevPlan.opId ? `; ${prevPlan.opId} keeps using it. This revision is not used by any operation` : ''}. {plan.status === 'approved' ? 'This revision is approved; switching an operation to it is a separate, explicit action.' : 'It cannot be used until approved.'}</Banner>}
        {proposal && <Banner tone="warn" title="Proposal — not executed">This plan was generated by AI. Nothing runs until a reviewer approves it and an operation passes preflight.</Banner>}
        <ApprovalBanner state={approvalState(plan)} action={plan.status === 'in_review' ? <Button size="sm" onClick={() => go('ai-plan-review', { id: plan.id })}>Open review</Button> : undefined}>
          {plan.decision ? `${plan.decision.by}, ${plan.decision.at}${plan.decision.note ? ' — ' + plan.decision.note : ''}` : plan.status === 'in_review' ? `Reviewer: ${plan.reviewer}${plan.expires ? ` · expires ${plan.expires}` : ''}` : undefined}
        </ApprovalBanner>
        {next && plan.status !== 'superseded' && <Banner tone="info" title={`Newer revision ${next.id} ${planVer(next)} is ${next.status.replace('_', ' ')}`} action={<Button size="sm" onClick={() => go('ai-plan', { id: next.id })}>Open {next.id}</Button>}>{plan.id} {planVer(plan)} remains {plan.status.replace('_', ' ')} and immutable{op && op.planId === plan.id ? `; ${op.id} keeps using it until the revision is approved and explicitly adopted` : ''}.</Banner>}
        <p className="text-xs text-muted">AI suggests content; a person remains responsible for verifying targets, ROE and scope.</p>
      </div>
      {replan && replan.cur?.id === plan.id && <div className="mb-4"><ReplanPanel pid={plan.projectId} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'builder', label: 'Plan Builder' }, { id: 'overview', label: 'Overview' }, { id: 'steps', label: 'Steps', count: plan.steps.length }, { id: 'branches', label: 'Branch Groups', count: groups.length }, { id: 'assets', label: 'Assets & Agents' },
        { id: 'risk', label: 'Scope & Risk' }, { id: 'refs', label: 'References' }, { id: 'history', label: 'Version History', count: history.length },
      ]} />
      <div className="mt-4 space-y-4">
        {tab === 'builder' && <Builder plan={plan} onRevise={() => setRevise(true)} request={request} />}
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader title="Overview" />
              <DescList items={[
                { k: 'Plan ID', v: <Mono>{plan.id}</Mono> }, { k: 'Title', v: plan.title }, { k: 'Version', v: planVer(plan) },
                { k: 'Parent version', v: prevPlan ? <IdLink onClick={() => go('ai-plan', { id: prevPlan.id })}>{prevPlan.id} {planVer(prevPlan)}</IdLink> : 'None (first version)' },
                { k: 'Project', v: <IdLink onClick={() => go('project', { id: p.id })}>{p.id}</IdLink> },
                { k: 'Conversation', v: <IdLink onClick={() => go('ai-operator', { id: plan.conversationId })}>{plan.conversationId}</IdLink> },
                { k: 'Operation', v: op ? <><IdLink onClick={() => go('operation', { id: op.id })}>{op.id}</IdLink>{op.planId === plan.id ? ' (uses this version)' : ` (uses ${op.planId})`}</> : 'None' },
                { k: 'Approval status', v: <Status kind="plan" value={plan.status} size="sm" /> },
                { k: 'Execution status', v: op && op.planId === plan.id ? `${op.id} is ${op.status.replace('_', ' ')}` : 'Not executed — no operation uses this version' },
                { k: 'Required agents', v: plan.agents.map((a) => `${a} ${pv.agentOf(a)?.host || ''}`.trim()).join(', ') || 'None' },
                { k: 'Targets', v: plan.assets.map((a) => pv.assetOf(a)?.name || a).join(', ') || 'None' },
                { k: 'Policy constraints', v: [`${plan.roeVersion} (${p.roeStatus})`, ...p.restrictions].join('; ') },
                { k: 'Risk summary', v: `${plan.steps.filter((s) => s.risk === 'low').length} low · ${plan.steps.filter((s) => s.risk === 'medium').length} medium · ${plan.steps.filter((s) => s.risk === 'high').length} high; ${plan.steps.filter((s) => s.needsApproval).length} approval gate(s)` },
                { k: 'Evidence links', v: (() => { const ev = plan.opId ? pv.evidence.filter((e) => e.opId === plan.opId) : []; return ev.length ? <span className="flex flex-wrap gap-2">{ev.map((e) => <IdLink key={e.id} onClick={() => go('evidence', { id: e.id })}>{e.id}</IdLink>)}</span> : 'None yet' })() },
                { k: 'Business objective', v: p.objectives[0]?.text || p.desc },
                { k: 'Purpose', v: plan.rationale },
                { k: 'Success criteria', v: p.objectives[0]?.criteria || 'All steps complete with evidence and no scope violations.' },
                { k: 'Estimated duration', v: `${plan.steps.length * 6} min (estimate)` },
                { k: 'Prerequisites', v: 'Approved ROE, in-scope assets, online agents' },
                { k: 'Assumptions', v: 'Targets remain in scope and agents stay connected during the run.' },
                { k: 'Approvers', v: plan.reviewer },
                { k: 'ROE version', v: plan.roeVersion },
              ]} />
            </Card>
            <Validation plan={plan} />
          </div>
        )}
        {tab === 'steps' && (
          <Table rows={plan.steps} rowKey={(s) => s.id} dense onRow={(s) => setStepId(s.id)} cols={[
            { key: 'id', header: 'Step', render: (s) => <Mono>{s.id}</Mono> },
            { key: 'n', header: 'Name', render: (s) => <div><div>{s.name}</div><div className="text-xs text-muted">{s.rationale}</div></div> },
            { key: 't', header: 'Technique', render: (s) => <Mono>{s.technique}</Mono> },
            { key: 'a', header: 'Asset', render: (s) => s.asset },
            { key: 'g', header: 'Agent', render: (s) => <Mono>{s.agent}</Mono> },
            { key: 'tl', header: 'Tool', render: (s) => <Mono>{s.tool}</Mono> },
            { key: 'r', header: 'Risk', render: (s) => <Risk v={s.risk} /> },
            { key: 'p', header: 'Permission', render: (s) => (s.needsApproval ? <span className="text-warn">Needs approval</span> : <span className="text-muted">Covered by plan</span>) },
          ]} />
        )}
        {tab === 'branches' && (
          groups.length ? <div className="space-y-4">
            <Banner tone="info" title="Preview of the parallel branch groups defined for this plan version">Branches run only after the plan is approved and an operation passes preflight. Retry and reassign always require approval.</Banner>
            {groups.map((g) => <div key={g.id} className="space-y-1"><div className="flex items-center gap-2 text-xs text-muted"><Mono>{g.id}</Mono> parent step <button className="text-accent hover:underline" onClick={() => setStepId(g.parentStep)}>{g.parentStep}</button> · aggregation step <button className="text-accent hover:underline" onClick={() => setStepId(g.aggStep)}>{g.aggStep}</button><button className="ml-auto text-accent hover:underline" onClick={() => go('ai-fanout', { id: g.id })}>Open full fan-out view →</button></div><FanOutCard groupId={g.id} /></div>)}
          </div> : <Empty title="No branch group in this plan version" action={sibling ? <Button onClick={() => go('ai-plan', { id: sibling.planId, tab: 'branches' })}>Open {sibling.planId} {sibling.planVer}</Button> : undefined}>{sibling ? `Branch group ${sibling.id} belongs to ${sibling.planId} ${sibling.planVer}. This version has no group of its own until it is approved and a group is defined.` : 'This plan has no parallel fan-out. All steps run sequentially.'}</Empty>
        )}
        {tab === 'assets' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardHeader title="Assets" /><ul className="space-y-1 text-sm">{plan.assets.map((id) => { const a = pv.assetOf(id); return <li key={id} className="flex justify-between"><span>{a?.name || id}</span><span className="text-xs text-muted">{id} · {a?.scope || 'unknown'}</span></li> })}</ul></Card>
            <Card><CardHeader title="Agents" /><ul className="space-y-1 text-sm">{plan.agents.map((id) => { const a = pv.agentOf(id); return <li key={id} className="flex justify-between"><span>{a?.host || id}</span><span className={cx('text-xs', a?.status === 'online' ? 'text-ok' : 'text-warn')}>{id} · {a?.status || 'unknown'}</span></li> })}</ul></Card>
          </div>
        )}
        {tab === 'risk' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Risks" /><ul className="list-disc space-y-1 pl-5 text-sm">{plan.risks.map((r) => <li key={r}>{r}</li>)}</ul></Card>
            <Card><CardHeader title="Scope" /><DescList cols={1} items={[{ k: 'ROE', v: `${plan.roeVersion} (${p.roeStatus})` }, { k: 'Window', v: p.window }, { k: 'Restrictions', v: p.restrictions.join('; ') }]} /></Card>
          </div>
        )}
        {tab === 'refs' && (
          <Card><CardHeader title="References" sub="Project objects this plan is based on" />
            <ul className="space-y-1.5 text-sm">
              <li>Project: <IdLink onClick={() => go('project', { id: p.id })}>{p.id}</IdLink></li>
              <li>Playbook: <IdLink onClick={() => go('playbook', { id: plan.playbookId })}>{plan.playbookId}</IdLink></li>
              <li>Conversation: <IdLink onClick={() => go('ai-operator', { id: plan.conversationId })}>{plan.conversationId}</IdLink></li>
              {plan.opId && <li>Operation: <IdLink onClick={() => go('operation', { id: plan.opId! })}>{plan.opId}</IdLink></li>}
            </ul>
          </Card>
        )}
        {tab === 'history' && (
          <div className="space-y-3">
            <p className="text-xs text-muted">Approved versions are immutable. Older versions open read-only; click a row to open it.</p>
            <Table rows={history} rowKey={(x) => x.id} onRow={(x) => go('ai-plan', { id: x.id })} cols={[
              { key: 'v', header: 'Version', render: (x) => <span className="whitespace-nowrap font-medium">{planVer(x)}{x.id === plan.id && <span className="ml-1 text-xs text-muted">(viewing)</span>}</span> },
              { key: 'id', header: 'Plan', render: (x) => <Mono className="whitespace-nowrap">{x.id}</Mono> },
              { key: 's', header: 'Status', render: (x) => <span className="whitespace-nowrap"><Status kind="plan" value={x.status} size="sm" /></span> },
              { key: 'u', header: 'Used by', render: (x) => { const o = pv.operations.find((y) => y.planId === x.id); return o ? <span className="whitespace-nowrap">{o.id} (current)</span> : <span className="text-muted">—</span> } },
              { key: 'pv', header: 'Parent', render: (x) => <span className="whitespace-nowrap">{x.prevPlanId ? `${x.prevPlanId} ${planVer(pv.chain.find((y) => y.id === x.prevPlanId) || x)}` : '—'}</span> },
              { key: 'c', header: 'Changes', render: (x) => x.changes?.join('; ') || 'Initial proposal' },
              { key: 'up', header: 'Updated', render: (x) => <span className="whitespace-nowrap">{x.updated}</span> },
              { key: 'cmp', header: '', render: (x) => <Button size="sm" disabled={!x.prevPlanId && !history.some((y) => y.prevPlanId === x.id)} title={!x.prevPlanId && !history.some((y) => y.prevPlanId === x.id) ? 'No adjacent version.' : undefined} onClick={(e) => { e.stopPropagation(); go('ai-plan-compare', { id: x.id }) }}>Compare</Button> },
            ]} />
          </div>
        )}
      </div>
      <StepDrawer plan={plan} stepId={stepId} onClose={() => setStepId(undefined)} />
      <ReviseDialog plan={plan} open={revise} onClose={() => setRevise(false)} />
    </>
  )
}

export function AiPlanReview() {
  return <PlanGuard title="Review AI Plan">{(plan) => <ReviewBody plan={plan} />}</PlanGuard>
}

/* Ticket 39: the risk-assessment derivation moved to the plans feature
   (src/features/plans/policy.ts) — the screen renders the same checks the
   approval handlers enforce. */
const CHK_ICON = { pass: <CheckCircle2 size={16} className="text-ok" aria-label="Pass" />, warn: <AlertTriangle size={16} className="text-warn" aria-label="Warn" />, fail: <XCircle size={16} className="text-bad" aria-label="Fail" /> }
const CHK_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }
function PolicyChecks({ plan }: { plan: Plan }) {
  const cs = usePlanChecks(plan)
  const n = (k: Chk['state']) => cs.filter((c) => c.state === k).length
  return (
    <Card>
      <CardHeader title="Policy checks" sub={`${n('pass')} pass · ${n('warn')} warn · ${n('fail')} fail — simulated policy engine`} />
      <ul className="space-y-2 text-sm">
        {cs.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <span className="mt-0.5">{CHK_ICON[c.state]}</span>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{c.label}</span><span className={cx('text-[11px] font-semibold', c.state === 'pass' ? 'text-ok' : c.state === 'warn' ? 'text-warn' : 'text-bad')}>{CHK_LABEL[c.state]}</span></div>
              <div className="text-xs text-muted">{c.detail}{c.to && c.state !== 'pass' && <> <button className="text-accent hover:underline" onClick={() => go(c.to!.page, { id: c.to!.id, tab: c.to!.tab })}>Open evidence →</button></>}</div></div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function stepState(s: PlanStep, pv: PlanView): 'pass' | 'warn' | 'fail' {
  const a = pv.assetByName(s.asset)
  const ag = pv.agentOf(s.agent)
  if ((a && a.scope !== 'in') || (ag && ag.status === 'lost')) return 'fail'
  return s.needsApproval ? 'warn' : 'pass'
}
const phasesOf = (steps: PlanStep[]) => { const out: { name: string; steps: PlanStep[] }[] = []; steps.forEach((s) => { const n = s.phase || 'Steps'; const g = out.find((x) => x.name === n); if (g) g.steps.push(s); else out.push({ name: n, steps: [s] }) }); return out }
const detailOf = (s: PlanStep, steps: PlanStep[], pv: PlanView) => {
  const i = steps.findIndex((x) => x.id === s.id); const ag = pv.agentOf(s.agent)
  return [
    { k: 'Goal', v: s.name }, { k: 'ATT&CK technique', v: <Mono>{s.technique}</Mono> }, { k: 'Expected evidence', v: `Sanitized output and a note linked to ${s.technique}` },
    { k: 'Allowed assets', v: s.asset }, { k: 'Agent capability', v: `${s.agent}${ag ? ` · ${ag.host} (${ag.os})` : ''} · ${s.tool}` }, { k: 'Dependency', v: i > 0 ? steps[i - 1].id : 'None' },
    { k: 'Timeout budget', v: s.risk === 'low' ? '5 min' : s.risk === 'medium' ? '10 min' : '15 min' }, { k: 'Expected change', v: 'None — read-only simulated activity' },
    { k: 'Risk class', v: <Risk v={s.risk} /> }, { k: 'Approval requirement', v: s.needsApproval ? 'Explicit approval gate before this step runs' : 'Covered by plan approval' },
    { k: 'Fallback on failure', v: s.needsApproval ? 'Pause operation and request review' : 'Mark step failed, pause, and let AI propose a revision' },
  ]
}
const SPILL = { pass: 'text-ok', warn: 'text-warn', fail: 'text-bad' }

function StepGroups({ plan, steps, sel, onSel, edit, move, remove }: { plan: Plan; steps: PlanStep[]; sel?: string; onSel: (id: string) => void; edit?: boolean; move?: (id: string, d: -1 | 1) => void; remove?: (id: string) => void }) {
  const pv = usePlanView(plan.id)
  if (!pv) return null
  return (
    <div className="space-y-3">
      {phasesOf(steps).map((g, gi) => (
        <section key={g.name} aria-label={g.name}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Phase {gi + 1} · {g.name}</h3>
          <ul className="space-y-1">
            {g.steps.map((s) => {
              const st = stepState(s, pv)
              return (
                <li key={s.id} className={cx('flex items-center gap-1 rounded-lg border', sel === s.id ? 'border-accent-line bg-accent-soft' : 'border-line bg-panel hover:bg-hover')}>
                  <button onClick={() => onSel(s.id)} aria-current={sel === s.id} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm">
                    <Mono className="whitespace-nowrap">{s.id}</Mono><span className="truncate">{s.name}</span>
                    <span className={cx('ml-auto whitespace-nowrap text-[11px] font-semibold', SPILL[st])}>{CHK_LABEL[st]}</span>
                  </button>
                  {edit && <span className="flex pr-1"><button aria-label={`Move ${s.id} up`} className="px-1 text-muted hover:text-fg" onClick={() => move?.(s.id, -1)}><ArrowUp size={14} /></button><button aria-label={`Move ${s.id} down`} className="px-1 text-muted hover:text-fg" onClick={() => move?.(s.id, 1)}><ArrowDown size={14} /></button><button aria-label={`Remove ${s.id}`} className="px-1 text-muted hover:text-bad" onClick={() => remove?.(s.id)}><Trash2 size={14} /></button></span>}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ApprovalImpact({ s, plan }: { s: PlanStep; plan: Plan }) {
  const pv = usePlanView(plan.id)
  if (!pv) return null
  const st = stepState(s, pv)
  return <div className={cx('rounded-lg border px-3 py-2 text-xs', st === 'fail' ? 'border-bad/30 bg-bad-soft' : st === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-line bg-subtle')}>
    <span className="font-semibold">Approval impact: </span>{st === 'fail' ? 'This step cannot run — its asset is out of scope or its agent is disconnected.' : st === 'warn' ? 'Approving the plan does not auto-approve this step; it pauses for an explicit gate when reached.' : 'Runs under plan approval; no extra gate.'}
  </div>
}

type Decision = 'approved' | 'returned' | 'rejected'
const DEC = { approved: { title: 'Approve plan', btn: 'Confirm approval', variant: 'primary' as const, hint: 'Reason / comment (required)' }, returned: { title: 'Return for changes', btn: 'Return for changes', variant: 'primary' as const, hint: 'What needs to change (required)' }, rejected: { title: 'Reject plan', btn: 'Reject plan', variant: 'danger' as const, hint: 'Reason for rejection (required)' } }

function ReviewBody({ plan }: { plan: Plan }) {
  const pv = usePlanView(plan.id)
  const services = useServices()
  const actions = usePlanActions()
  const can = useCan()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const [sel, setSel] = useState<string | undefined>(plan.steps[0]?.id)
  const [dec, setDec] = useState<Decision | null>(null)
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  const [audit, setAudit] = useState(false)
  const [stepOpen, setStepOpen] = useState(false)
  const crumbs = useCrumbs(plan, 'Approval review')
  const checks = usePlanChecks(plan)
  const cmp = usePlanCompare(plan.id)
  if (!pv) return null
  const p = pv.project
  const next = pv.next
  const prev = pv.prev
  const pb = pv.playbook
  const op = pv.op
  const fails = checks.filter((c) => c.state === 'fail'), warns = checks.filter((c) => c.state === 'warn')
  const inReview = plan.status === 'in_review'
  const allowed = can('approvePlan')
  const self = plan.requestedBy === me.name
  const step = plan.steps.find((x) => x.id === sel) || plan.steps[0]
  /* Ticket 42: the review diff and re-approval notes derive from the typed
     compare read — the same derivation the side-by-side route renders. */
  const cmpData = cmp.data && cmp.data.current.id === plan.id ? cmp.data : undefined
  const d = prev && cmpData ? cmpData.diff : undefined
  const notes = cmpData?.notes
  const online = plan.agents.filter((a) => { const x = pv.agentOf(a); return x && (x.status === 'online' || x.status === 'idle') }).length
  const highest = plan.steps.some((s) => s.risk === 'high') ? 'high' : plan.steps.some((s) => s.risk === 'medium') ? 'medium' : 'low'
  const whyNo = (k: Decision) => !inReview ? `Plan is ${plan.status.replace('_', ' ')}; no decision is pending.` : !allowed ? `Your role (${me.role}) cannot decide AI plans. A reviewer or admin must do this.` : k === 'approved' && self ? 'You requested this plan; another reviewer must approve it.' : k === 'approved' && fails.length ? `${fails.length} policy check(s) FAIL: ${fails.map((f) => f.label).join(', ')}. Fix them or return the plan.` : ''
  const submit = () => {
    if (!dec) return
    const r = actions.decide(plan.id, dec, reason.trim())
    if (!r.ok) { setErr(r.error || 'The decision could not be recorded.'); setDec(null); return }
    setErr(''); setDec(null); setReason(''); setAck(false)
    toast(`${plan.id} ${planVer(plan)} ${dec === 'approved' ? 'approved' : dec === 'returned' ? 'returned for changes' : 'rejected'}.`, dec === 'approved' ? 'ok' : 'warn')
  }
  const create = () => {
    const r = actions.execute(plan.id)
    if (!r.ok || !r.opId) { setErr(r.error || 'Could not create the operation.'); return }
    toast(`Operation ${r.opId} created. Complete preflight before starting.`, 'ok')
    go('preflight', { id: r.opId })
  }
  /* Ticket 40: the Create Operation courtesy reflects the binding-time rule
     the bridge handler enforces — an approval past its absolute deadline is
     unusable even while the stored status still reads approved. The handler
     re-checks at click time either way; this only surfaces the reason. */
  const bridgeable = services ? effectivePlanStatus(plan, services.clock.now()) : plan.status
  const expiredApproval = plan.status === 'approved' && bridgeable === 'expired'
  const createWhyBridge = expiredApproval
    ? `The approval expired ${plan.expires ? tz(plan.expires) : ''} — re-approve the plan before an operation can be created.`
    : 'Your role cannot create operations.'
  const rows = pv.audit
  const expired = plan.status === 'expired'
  return (
    <>
      <PageHeader crumbs={crumbs} title="Review AI Plan"
        meta={<><Mono>{plan.id}</Mono><span className="text-sm font-medium">{planVer(plan)}</span><Status kind="plan" value={plan.status} /><Mono>{plan.projectId}</Mono></>}
        sub={<>{plan.title} · Submitted by {plan.requestedBy} · Reviewer {plan.reviewer} · Bound to {plan.roeVersion} · Playbook {pb ? `${pb.name} v${pb.version}` : plan.playbookId} · {plan.expires ? `Approval expiry ${tz(plan.expires)}` : 'No expiry set until approved'}</>}
        actions={<><Button onClick={() => setAudit(true)}>Audit trail</Button><Button disabled={!prev && !next} title={!prev && !next ? 'No other revision to compare.' : undefined} onClick={() => go('ai-plan-compare', { id: plan.id })}>Compare revision</Button></>} />
      <div className="space-y-4">
        <ApprovalBanner state={approvalState(plan)} title={plan.status === 'proposed' || plan.status === 'draft' ? 'Approval not requested' : undefined}>
          {plan.decision ? `${plan.decision.by}, ${tz(plan.decision.at)}${plan.decision.note ? ' — ' + plan.decision.note : ''}` : inReview ? `Waiting for ${plan.reviewer}${plan.expires ? ` · expires ${tz(plan.expires)}` : ''}` : plan.status === 'draft' || plan.status === 'proposed' ? 'Request review from the plan page before it can be decided.' : undefined}
        </ApprovalBanner>
        {expired && <Banner tone="warn" title="Approval expired">Re-request review to continue; the operation cannot start on an expired approval.</Banner>}
        {op && op.planId === plan.id && plan.status === 'approved' && <Banner tone="info" title={`${op.id} is pinned to ${plan.id} ${planVer(plan)}`}>A started operation keeps the approved version. Changes require a new revision and re-approval.</Banner>}
        {prev && prev.opId && <Banner tone="info" title={`${prev.opId} keeps using ${prev.id} ${planVer(prev)}`}>Approving this revision does not switch the operation. {prev.id} stays {prev.status.replace('_', ' ')} and immutable.</Banner>}
        {next && next.status !== 'superseded' && <Banner tone="warn" title="Plan changed" action={<Button size="sm" onClick={() => go('ai-plan-review', { id: next.id })}>Review {next.id}</Button>}>This plan was revised as {next.id} {planVer(next)} ({next.status.replace('_', ' ')}). {plan.id} is unchanged.</Banner>}
        {plan.status === 'superseded' && <Banner tone="info" title="Superseded — read-only">No decision can be recorded on a superseded version.</Banner>}
        {p.roeStatus !== 'approved' && <Banner tone="bad" title="Missing scope">{p.id} has no approved ROE, so this plan cannot be approved.</Banner>}
        {err && <Banner tone="bad" title="Decision not recorded">{err}</Banner>}
        <Card>
          <DescList cols={3} items={[
            { k: 'Objective', v: p.objectives[0]?.text || plan.rationale }, { k: 'Steps', v: `${plan.steps.length} in ${phasesOf(plan.steps).length} phases` }, { k: 'Overall risk', v: <Risk v={highest} /> },
            { k: 'Allowed targets', v: `${plan.assets.length} assets: ${[...new Set(plan.steps.map((s) => s.asset))].join(', ')}` }, { k: 'Time window', v: p.window }, { k: 'Required tools', v: `${new Set(plan.steps.map((s) => s.tool)).size} tools (simulated)` },
            { k: 'Agent readiness', v: `${online} of ${plan.agents.length} connected` }, { k: 'Gated steps', v: plan.steps.filter((s) => s.needsApproval).length }, { k: 'Created by', v: `${plan.author} · ${tz(plan.created)}` },
          ]} />
        </Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <Card><CardHeader title="Steps by phase" sub="PASS / WARN (gate) / FAIL" /><StepGroups plan={plan} steps={plan.steps} sel={step?.id} onSel={setSel} /></Card>
          <div className="space-y-4">
            {step && <Card><CardHeader title={<><Mono>{step.id}</Mono> {step.name}</>} sub={step.phase} actions={<Button size="sm" onClick={() => setStepOpen(true)}>Step detail</Button>} /><DescList cols={2} items={detailOf(step, plan.steps, pv)} /><div className="mt-3"><ApprovalImpact s={step} plan={plan} /></div></Card>}
            <PolicyChecks plan={plan} />
            <Card>
              <CardHeader title={prev ? `Diff vs ${prev.id} ${planVer(prev)}` : 'Revision diff'} actions={(prev || next) ? <Button size="sm" onClick={() => go('ai-plan-compare', { id: plan.id })}>Side-by-side</Button> : undefined} />
              {!d ? <p className="text-sm text-muted">First version — nothing to compare.</p> : (
                <div className="space-y-1 text-sm">
                  <p><span className="font-semibold text-ok">Added {d.added.length}</span> · <span className="font-semibold text-bad">Removed {d.removed.length}</span> · <span className="font-semibold text-warn">Modified {d.changed.length}</span></p>
                  {plan.changes && <ul className="list-disc pl-5 text-xs">{plan.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
                  {d.changed.length > 0 && <ul className="list-disc pl-5 text-xs text-muted">{d.changed.slice(0, 4).map(({ step: s, f }) => <li key={s.id}><Mono>{s.id}</Mono> {f.join(', ')}</li>)}{d.changed.length > 4 && <li>and {d.changed.length - 4} more</li>}</ul>}
                </div>
              )}
            </Card>
            {prev && notes && <Card><CardHeader title="Re-approval notes" sub={notes.length ? 'These changes are not covered by the earlier approval.' : undefined} />{notes.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs">{notes.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted">No scope, tool, target, risk or concurrency changes detected. A new approval is still required for this version.</p>}</Card>}
            {pv.branchGroups.filter((g) => g.planId === plan.id).map((g) => <div key={g.id}><FanOutCard groupId={g.id} /></div>)}
            {plan.risks.length > 0 && <Card><CardHeader title="Risks" /><ul className="list-disc space-y-1 pl-5 text-sm">{plan.risks.map((r) => <li key={r}>{r}</li>)}</ul></Card>}
          </div>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
          {inReview ? <>
            <Gated allowed={!whyNo('returned')} reason={whyNo('returned')}><Button onClick={() => setDec('returned')}>Return for Changes</Button></Gated>
            <Gated allowed={!whyNo('rejected')} reason={whyNo('rejected')}><Button variant="danger" onClick={() => setDec('rejected')}>Reject</Button></Gated>
            <Gated allowed={!whyNo('approved')} reason={whyNo('approved')}><Button variant="primary" onClick={() => setDec('approved')}>Approve Plan</Button></Gated>
            {/* Ticket 39: the requester (or a scope manager) can pull the plan out of review before a decision. */}
            <Gated allowed={me.name === plan.requestedBy || can('editScope', plan.projectId)} reason={me.name === plan.requestedBy ? '' : 'Only the requester, a Red Team Manager or an Organization Admin can withdraw this review.'}>
              <Button onClick={() => { const r = actions.withdraw(plan.id); if (r.ok) toast(`${plan.id} withdrawn from review.`, 'warn'); else toast(r.error || 'The review could not be withdrawn.', 'bad') }}>Withdraw from review</Button>
            </Gated>
            <span className="text-xs text-muted">A reason is required for every decision and is written to the audit trail.</span>
          </> : plan.status === 'approved' ? <>
            <span className="text-sm">Approval is a precondition only — the operation still needs preflight.</span>
            {op && <Button onClick={() => go('operation', { id: op.id })}>Open {op.id}</Button>}
            {!op && <Gated allowed={can('run') && !expiredApproval} reason={expiredApproval ? createWhyBridge : 'Your role cannot create operations.'}><Button variant="primary" icon={Rocket} onClick={create}>Create operation &amp; run preflight</Button></Gated>}
          </> : <span className="text-sm text-muted">No decision is pending for a plan in status “{plan.status.replace('_', ' ')}”.{(plan.status === 'draft' || plan.status === 'proposed') && <> <button className="text-accent hover:underline" onClick={() => go('ai-plan', { id: plan.id })}>Open the plan to request review →</button></>}</span>}
        </div>
      </div>
      <Modal open={!!dec} onClose={() => setDec(null)} title={dec ? `${DEC[dec].title}: ${plan.id} ${planVer(plan)}` : ''}
        footer={dec && <><Button onClick={() => setDec(null)}>Cancel</Button><Button variant={DEC[dec].variant} disabled={!reason.trim() || (dec === 'approved' && warns.length > 0 && !ack)} title={!reason.trim() ? 'A reason is required.' : dec === 'approved' && warns.length > 0 && !ack ? 'Acknowledge the warnings first.' : undefined} onClick={submit}>{DEC[dec].btn}</Button></>}>
        {dec && <div className="space-y-3 text-sm">
          {dec === 'approved' && <ul className="list-disc space-y-1 pl-5"><li>Covers only the {plan.steps.length} steps and {plan.assets.length} assets in this version, under {plan.roeVersion}.</li><li>Expires {tz(plan.expires) === '—' ? 'in 24 hours (UTC+7)' : tz(plan.expires)}.</li><li>Does not start anything; an operation must still pass preflight.</li>{op && op.planId === plan.id && <li>{op.id} can be resumed afterwards.</li>}<li>Reviewer recorded: {me.name}.</li></ul>}
          {dec === 'approved' && warns.length > 0 && <Check checked={ack} onChange={setAck} label={`I reviewed ${warns.length} warning(s): ${warns.map((w) => w.label).join(', ')}`} />}
          <Field label={DEC[dec].hint} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        </div>}
      </Modal>
      <StepDrawer plan={plan} stepId={stepOpen ? step?.id : undefined} onClose={() => setStepOpen(false)} />
      <Drawer open={audit} onClose={() => setAudit(false)} title={`Audit trail — ${plan.id}`}>
        {rows.length === 0 ? <p className="text-sm text-muted">No audit entries yet for this plan. Decisions will appear here with who, when, version and why.</p> : (
          <ul className="space-y-3 text-sm">{rows.map((a) => <li key={a.id} className="rounded-lg border border-line p-3"><div className="font-medium">{a.action}</div><dl className="mt-1 grid grid-cols-[70px_1fr] gap-x-2 text-xs"><dt className="text-muted">Who</dt><dd>{a.actor} ({a.role})</dd><dt className="text-muted">When</dt><dd>{tz(a.at)}</dd><dt className="text-muted">Version</dt><dd>{planVer(plan)}</dd><dt className="text-muted">Why</dt><dd>{a.reason || '—'}</dd></dl></li>)}</ul>
        )}
      </Drawer>
    </>
  )
}

export function AiPlanCompare() {
  return <PlanGuard title="Plan Revision Compare">{(plan) => <CompareBody plan={plan} />}</PlanGuard>
}

/** Ticket 42: the compare route renders the typed compare read (diff + notes derived from the stored revisions). */
function CompareBody({ plan }: { plan: Plan }) {
  const actions = usePlanActions()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const cmp = usePlanCompare(plan.id)
  const crumbs = useCrumbs(plan, 'Compare')
  if (cmp.isPending) return <><PageHeader title="Plan Revision Compare" crumbs={crumbs} /><p className="py-3 text-sm text-muted" role="status">Loading comparison…</p></>
  if (cmp.isError) {
    const failure = (cmp.error as PlanCompareError).failure
    return <><PageHeader title="Plan Revision Compare" crumbs={crumbs} /><Empty title={failure.kind === 'conflict' ? 'No revision to compare' : 'Could not load the comparison'} action={<Button onClick={() => go('ai-plan', { id: plan.id })}>Back to plan</Button>}>{failure.message}</Empty></>
  }
  const { previous: oldP, current: newP, diff: d, notes } = cmp.data
  const hi = (x: Plan) => x.steps.filter((s) => s.risk !== 'low').length
  const gated = (x: Plan) => x.steps.filter((s) => s.needsApproval).length
  const needsReapproval = newP.status !== 'approved'
  const canReq = can('plan') && (newP.status === 'proposed' || newP.status === 'draft')
  return (
    <>
      <PageHeader crumbs={crumbs} title="Plan Revision Compare"
        meta={<><Mono>{oldP.id}</Mono><span className="text-sm text-muted">{planVer(oldP)}</span><span aria-hidden>→</span><Mono>{newP.id}</Mono><span className="text-sm text-muted">{planVer(newP)}</span></>}
        sub={`Revision authored by ${newP.requestedBy} with AI provenance (${newP.author}).`}
        actions={<>
          <Button onClick={() => go('ai-operator', { id: newP.conversationId })}>Return to Chat</Button>
          <Button onClick={() => go('ai-plan', { id: oldP.id })}>Open {planVer(oldP)}</Button>
          <Button onClick={() => go('ai-plan-review', { id: newP.id })}>Approval Review</Button>
          <Button onClick={() => { toast(`${newP.id} kept as a draft proposal.`, 'info'); go('ai-plan', { id: newP.id }) }}>Accept Revision as Draft</Button>
          <Gated allowed={canReq} reason={!can('plan') ? 'Your role cannot request plan approval.' : `${newP.id} is already ${newP.status}; re-approval was requested or decided.`}>
            <Button variant="primary" onClick={() => { const r = actions.requestApproval(newP.id); if (r.ok) toast(`Re-approval requested for ${newP.id}.`, 'ok'); else toast(r.error || 'The re-approval request could not be recorded.', 'bad') }}>Request Reapproval</Button>
          </Gated>
        </>} />
      <div className="space-y-4">
        {needsReapproval
          ? <Banner tone="warn" title="Approval required">{newP.id} {planVer(newP)} is {newP.status.replace('_', ' ')}. The earlier approval of {oldP.id} does not carry over and the approved plan was not modified.</Banner>
          : <ApprovalBanner state="approved">{newP.id} {planVer(newP)} was re-approved.</ApprovalBanner>}
        {oldP.opId && <Banner tone="info" title="Linked operation">{oldP.opId} keeps using {oldP.id} {planVer(oldP)}. {oldP.id} stays {oldP.status.replace('_', ' ')} and immutable; {newP.id} is {newP.status.replace('_', ' ')} and is never applied to the operation automatically.</Banner>}
        <Card><CardHeader title="Re-approval notes" sub={`${newP.id} ${planVer(newP)} needs its own approval`} />{notes.length ? <ul className="list-disc space-y-0.5 pl-5 text-sm">{notes.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted">No scope, tool, target, risk or concurrency changes detected.</p>}</Card>
        <div className="grid gap-4 md:grid-cols-4">
          {[['Steps', oldP.steps.length, newP.steps.length], ['Approval gates', gated(oldP), gated(newP)], ['Medium/high-risk steps', hi(oldP), hi(newP)], ['Assets', oldP.assets.length, newP.assets.length]].map(([l, a, b]) => (
            <Card key={String(l)}><div className="text-xs text-muted">{l}</div><div className="mt-1 text-lg font-semibold">{a} → {b}</div></Card>
          ))}
        </div>
        <Card><CardHeader title="Changes" sub={`Requested: ${newP.changes?.join('; ') || 'not recorded'}`} />
          <div className="space-y-3 text-sm">
            <section aria-label="Added steps"><h3 className="font-semibold text-ok">Added ({d.added.length})</h3>{d.added.length ? <ul className="list-disc pl-5">{d.added.map((s) => <li key={s.id}><Mono>{s.id}</Mono> {s.name}</li>)}</ul> : <p className="text-muted">No steps added.</p>}</section>
            <section aria-label="Removed steps"><h3 className="font-semibold text-bad">Removed ({d.removed.length})</h3>{d.removed.length ? <ul className="list-disc pl-5">{d.removed.map((s) => <li key={s.id}><Mono>{s.id}</Mono> {s.name}</li>)}</ul> : <p className="text-muted">No steps removed.</p>}</section>
            <section aria-label="Changed steps"><h3 className="font-semibold text-warn">Changed ({d.changed.length})</h3>{d.changed.length ? <ul className="list-disc pl-5">{d.changed.map(({ step, f }) => <li key={step.id}><Mono>{step.id}</Mono> {step.name}: {f.join(', ')}</li>)}</ul> : <p className="text-muted">No step-level changes.</p>}</section>
          </div>
        </Card>
        <Card pad={false}>
          <div className="grid divide-x divide-line md:grid-cols-2">
            {[oldP, newP].map((x) => (
              <div key={x.id} className="p-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Mono>{x.id}</Mono> {planVer(x)} <Status kind="plan" value={x.status} size="sm" /></div>
                <ul className="space-y-1 text-xs">{x.steps.map((s) => <li key={s.id} className="flex justify-between gap-2"><span><Mono>{s.id}</Mono> {s.name}</span><span>{s.needsApproval ? 'gated' : ''} <Risk v={s.risk} /></span></li>)}</ul></div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
