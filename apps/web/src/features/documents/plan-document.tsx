import type { ReactElement } from 'react'
import { ArrowRight, GitBranch, ShieldAlert, Target } from 'lucide-react'
import { planVer, type Plan, type Project } from '../../data'
import { go } from '../../router/navigate'
import { Banner, Button, DescList, Status } from '../../ui/index'

/** Readable OPPLAN, rendered from the same plan record as the JSON source. */
export function PlanDocument({ plan, project }: { plan: Plan; project: Project }): ReactElement {
  const phases = [...new Set(plan.steps.map((step) => step.phase || 'Unsequenced steps'))]
  const gates = plan.steps.filter((step) => step.needsApproval).length
  return (
    <article aria-label={`OPPLAN ${plan.id}`} className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="border-b border-line bg-subtle/50 p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold uppercase tracking-widest text-accent">Operation plan</span><span className="text-muted">Document {plan.id} · {planVer(plan)}</span><Status kind="plan" value={plan.status} size="sm" /></div>
        <h3 className="text-xl font-semibold leading-snug">{plan.title}</h3>
        <p className="mt-2 text-xs text-muted">{plan.steps.length} steps · {phases.length} phases · {plan.assets.length} assets · {gates} approval gates</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => go('ai-operator', { id: plan.conversationId })}>Continue conversation</Button>
          <Button size="sm" onClick={() => go('ai-plan-review', { id: plan.id })}>Review & approval</Button>
          {plan.opId && <Button size="sm" icon={ArrowRight} onClick={() => go('operation', { id: plan.opId })}>Open execution</Button>}
        </div>
      </header>
      <div className="space-y-7 p-5 sm:p-6">
        {(plan.roeVersion !== project.roeVersion || project.roeStatus !== 'approved') && <Banner tone="warn" title="Scope review required">This document references {plan.roeVersion}. The project ROE is {project.roeVersion} ({project.roeStatus}); reading or editing this document does not authorize execution.</Banner>}
        <section><h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Target size={16} className="text-accent" />Objective & rationale</h4><p className="text-sm leading-relaxed text-muted">{plan.rationale}</p></section>
        <section>
          <h4 className="mb-4 text-sm font-semibold">Execution sequence</h4>
          {phases.length ? <div className="space-y-6">{phases.map((phase, phaseIndex) => (
            <section key={phase}>
              <h5 className="mb-3 flex items-center gap-2 text-sm font-medium"><span className="rounded-md bg-accent-soft px-2 py-1 font-mono text-xs text-accent">{String(phaseIndex + 1).padStart(2, '0')}</span>{phase}</h5>
              <ol className="ml-3 space-y-3 border-l border-line pl-5">
                {plan.steps.filter((step) => (step.phase || 'Unsequenced steps') === phase).map((step) => (
                  <li key={step.id} className="rounded-lg border border-line bg-subtle/30 p-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-muted">{step.id}</span><span className="min-w-0 flex-1 text-sm font-medium">{step.name}</span><Status kind="sev" value={step.risk} size="sm" />{step.needsApproval && <span className="inline-flex items-center gap-1 text-xs font-medium text-warn"><ShieldAlert size={13} />Approval required</span>}</div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted"><span className="text-accent">{step.technique}</span><span>Target: {step.asset}</span><span>Agent: {step.agent}</span><span>Tool: {step.tool}</span></div>
                    {step.rationale && <p className="mt-2 text-xs leading-relaxed text-muted">{step.rationale}</p>}
                  </li>
                ))}
              </ol>
            </section>
          ))}</div> : <p className="text-sm text-muted">No steps have been authored yet.</p>}
        </section>
        <section><h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={16} className="text-warn" />Risk register</h4>{plan.risks.length ? <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">{plan.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul> : <p className="text-sm text-muted">No risks recorded.</p>}</section>
        <section className="border-t border-line pt-5"><h4 className="mb-3 text-sm font-semibold">Document control</h4><DescList cols={2} items={[
          { k: 'Author / requested by', v: `${plan.author} / ${plan.requestedBy}` }, { k: 'Reviewer', v: plan.reviewer },
          { k: 'ROE reference', v: plan.roeVersion }, { k: 'Playbook reference', v: plan.playbookId },
          { k: 'Updated', v: plan.updated }, { k: 'Valid until', v: plan.expires || 'Not specified' },
        ]} />{plan.decision && <blockquote className="mt-4 rounded-lg border-l-2 border-accent bg-subtle p-3 text-sm"><p>{plan.decision.note}</p><footer className="mt-2 text-xs text-muted">{plan.decision.by} · {plan.decision.at}</footer></blockquote>}</section>
        {(plan.prevPlanId || !!plan.changes?.length) && <section className="rounded-lg border border-line p-4"><h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><GitBranch size={16} className="text-accent" />Revision details</h4>{plan.prevPlanId && <p className="mb-2 text-xs text-muted">Previous document: {plan.prevPlanId}. Select it from the document list to read the earlier version.</p>}<ul className="list-disc space-y-1 pl-5 text-sm text-muted">{plan.changes?.map((change) => <li key={change}>{change}</li>)}</ul></section>}
      </div>
    </article>
  )
}
