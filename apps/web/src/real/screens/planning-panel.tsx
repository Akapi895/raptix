/**
 * Real planning panel (integration ticket 04): the engagement's actual plan
 * documents, bundle states, readiness and the one-way handoff confirmation.
 * Readiness is a runtime signal only â€” it never grants execution permission,
 * and an OPPLAN document is never presented as business plan approval (D2).
 */
import { useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CheckCircle2, CircleAlert, FileText, Lock, RefreshCw } from 'lucide-react'
import { PLANNING_DOCUMENTS, type ConopsView, type DeconflictionView, type OpplanView, type PlanningDocument, type PlanningView, type PlanningState, type RoEView } from '@raptix/web-contracts'
import { confirmHandoff, fetchPlanning } from '../api'
import { projectKeys } from '../queries'
import { go } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, DescList, Skeleton, Status, cx } from '../../ui'

const STATE_TONE: Record<PlanningState, 'ok' | 'bad' | 'warn' | 'neutral'> = { ready: 'ok', missing: 'neutral', invalid: 'bad', unavailable: 'warn' }
const STATE_LABEL: Record<PlanningState, string> = { ready: 'Ready', missing: 'Missing', invalid: 'Invalid', unavailable: 'Unavailable' }

function fmt(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) + 'Z' : 'â€”'
}

export function RealPlanningPanel({ engagementId, handoffConfirmedAt }: { engagementId: string; handoffConfirmedAt: string | null }): ReactElement {
  const client = useQueryClient()
  const planning = useQuery({ queryKey: ['real', 'planning', engagementId], queryFn: () => fetchPlanning(engagementId) })
  const [patchError, setPatchError] = useState<string | null>(null)
  const confirm = useMutation({
    mutationFn: () => confirmHandoff(engagementId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['real', 'planning'] })
      void client.invalidateQueries({ queryKey: projectKeys.detail(engagementId) })
      void client.invalidateQueries({ queryKey: ['real', 'projects'] })
    },
    onError: (error) => setPatchError(error instanceof Error ? error.message : 'Confirming the handoff failed.'),
  })

  if (planning.isPending) {
    return <div className="space-y-4" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>
  }
  if (planning.isError || !planning.data) {
    const message = planning.error instanceof Error ? planning.error.message : 'The planning documents could not be loaded.'
    return (
      <div className="mx-auto max-w-xl pt-8 text-center" role="alert">
        <h2 className="text-base font-semibold">Could not load planning documents</h2>
        <p className="mt-2 break-words text-sm text-muted">{message}</p>
        <Button variant="primary" className="mt-4" icon={RefreshCw} onClick={() => void planning.refetch()}>Try again</Button>
      </div>
    )
  }
  const view: PlanningView = planning.data

  return (
    <div className="space-y-4">
      {view.readiness.state === 'ready' ? (
        <Banner tone="ok" icon={CheckCircle2} title="Planning documents ready">
          All required documents are present and valid. Readiness is a runtime signal â€” execution still requires the approved lifecycle steps and never follows from this banner alone.
        </Banner>
      ) : (
        <Banner tone="warn" icon={CircleAlert} title="Planning is blocked">
          <ul className="list-inside list-disc">
            {view.readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Banner>
      )}
      {patchError && <Banner tone="bad" title="Handoff confirmation failed" action={<Button size="sm" variant="ghost" onClick={() => setPatchError(null)}>Dismiss</Button>}>{patchError}</Banner>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Plan documents" sub="Generated in the AI workspace and stored in the engagement workspace. OPPLAN is the operational plan document â€” not a business plan approval." />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PlanCard name="roe" title="Rules of Engagement" doc={view.documents.roe} render={(c) => (
                <DescList
                  items={[
                    { k: 'Engagement type', v: c.engagement_type },
                    { k: 'Window', v: `${c.start_date} â†’ ${c.end_date}` },
                    { k: 'Testing window', v: c.testing_window },
                    { k: 'Authorization', v: c.authorization_reference ?? 'Not recorded' },
                    { k: 'Scope', v: `${(c.in_scope ?? []).length} in / ${(c.out_of_scope ?? []).length} out` },
                    { k: 'Prohibited actions', v: String((c.prohibited_actions ?? []).length) },
                  ]}
                />
              )} />
              <PlanCard name="conops" title="Concept of Operations" doc={view.documents.conops} render={(c) => (
                <div className="space-y-2">
                  <p className="whitespace-pre-wrap text-sm text-fg">{c.executive_summary}</p>
                  {c.success_criteria && c.success_criteria.length > 0 && <p><span className="font-medium text-fg">Success criteria:</span> {c.success_criteria.join('; ')}</p>}
                </div>
              )} />
              <PlanCard name="deconfliction" title="Deconfliction" doc={view.documents.deconfliction} render={(c) => (
                <DescList
                  items={[
                    { k: 'SOC contact', v: c.soc_contact ?? 'Not recorded' },
                    { k: 'Notification', v: c.notification_procedure ?? 'Not recorded' },
                    { k: 'Identifiers', v: String((c.identifiers ?? []).length) },
                  ]}
                />
              )} />
              <PlanCard name="opplan" title="Operation Plan (OPPLAN)" doc={view.documents.opplan} render={(c) => (
                <div className="space-y-2">
                  <p><span className="font-medium text-fg">Threat profile:</span> {c.threat_profile}</p>
                  {(c.objectives ?? []).length > 0 && (
                    <ul className="space-y-1">
                      {(c.objectives ?? []).map((o) => (
                        <li key={o.id} className="text-fg"><span className="font-mono">{o.id}</span> Â· {o.title} <span className="text-muted">({o.phase}{o.status ? `, ${o.status}` : ''}{o.blocked_by?.length ? `, blocked by ${o.blocked_by.join(', ')}` : ''})</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              )} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Document bundle" sub="Every required planning document and its current state." />
            <ul className="flex flex-wrap gap-2">
              {PLANNING_DOCUMENTS.map((name) => {
                const state = view.bundle[name]
                return (
                  <li key={name} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', {
                    ok: 'border-ok/30 bg-ok-soft text-ok', bad: 'border-bad/30 bg-bad-soft text-bad', warn: 'border-warn/30 bg-warn-soft text-warn', neutral: 'border-line bg-subtle text-muted',
                  }[STATE_TONE[state]])}>
                    <FileText size={12} aria-hidden />{name}: {STATE_LABEL[state]}
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Planning handoff" sub="One-way confirmation that planning moved from drafting to the AI workspace. It can be set once and is never unset by the UI." />
            <p className="text-sm">
              {handoffConfirmedAt ? <span className="text-ok">Confirmed at {fmt(handoffConfirmedAt)}</span> : <span className="text-muted">Not confirmed yet.</span>}
            </p>
            {!handoffConfirmedAt && (
              <div className="mt-3">
                <Button variant="primary" icon={Lock} disabled={confirm.isPending || view.readiness.state !== 'ready'} title={view.readiness.state === 'ready' ? 'Confirms planning handoff on the server (one-way)' : 'Required planning documents must be ready before handoff'}
                  onClick={() => { setPatchError(null); confirm.mutate() }}>
                  {confirm.isPending ? 'Confirmingâ€¦' : 'Confirm planning handoff'}
                </Button>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="AI workspace" />
            <p className="text-sm text-muted">Plan documents are drafted with the assistant in the engagement's planning conversations.</p>
            <div className="mt-3">
              <Button variant="secondary" icon={Bot} onClick={() => go('ai-operator', { id: engagementId })}>Open AI workspace</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Readiness" />
            <DescList
              items={[
                { k: 'State', v: <Status kind="gate" value={view.readiness.state === 'ready' ? 'passed' : 'pending'} size="sm" label={view.readiness.state === 'ready' ? 'Ready' : 'Blocked'} /> },
                { k: 'Runtime signal', v: view.readiness.runtimeSignal },
                { k: 'Reasons', v: view.readiness.reasons.length === 0 ? 'None' : view.readiness.reasons.join('; ') },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}

function DocUnavailable({ name, title, state }: { name: string; title: string; state: Exclude<PlanningState, 'ready'> }): ReactElement {
  return (
    <div className="rounded-xl border border-line bg-subtle p-4" data-testid={`plan-doc-${name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Status kind="gate" value={state === 'invalid' ? 'failed' : 'pending'} size="sm" label={STATE_LABEL[state]} />
      </div>
      <p className="mt-2 text-xs text-muted">
        {state === 'missing' ? 'This document has not been generated yet.' : state === 'invalid' ? 'The stored document failed validation â€” regenerate it in the AI workspace.' : 'The document source is unavailable right now.'}
      </p>
    </div>
  )
}

function PlanCard<T extends RoEView | ConopsView | DeconflictionView | OpplanView>({ name, title, doc, render }: {
  name: string
  title: string
  doc: PlanningDocument<T>
  render: (content: T) => ReactElement
}): ReactElement {
  if (doc.state !== 'ready') return <DocUnavailable name={name} title={title} state={doc.state} />
  return (
    <div className="rounded-xl border border-line bg-panel p-4" data-testid={`plan-doc-${name}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Status kind="gate" value="passed" size="sm" label="Ready" />
      </div>
      <div className="mt-2 text-xs text-muted">{render(doc.content)}</div>
    </div>
  )
}
