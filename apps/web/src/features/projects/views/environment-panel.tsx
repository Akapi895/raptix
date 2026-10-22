/**
 * Project environment panel (ADR-0092 §1.2, §4.3). It shows this project's environment and the deployment slot, and
 * sends activate and stop through the control plane. Switching to this project from another one is two explicit
 * steps that the operator confirms: stop the running project, then start this one.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import type { EnvironmentCommandResult, EnvironmentStateView } from '@raptix/web-contracts'
import { listEngagements } from '../remote';
import { fetchEnvironment, submitEnvironmentCommand } from '../environment-api'
import { needsReconcile, nextAction, outcomeOf, ownHolder, refreshIntervalFor } from '../../../real/environment-logic'
import { ApiTransportError } from '../../../platform/transport'
import { Banner, Button, Card, CardHeader } from '../../../ui/index'

type Action = 'activate' | 'stop'
interface Notice { tone: 'info' | 'warn' | 'bad' | 'ok'; text: string }

const PERMISSION = "You can view this project's environment, but you cannot change it."
const CONTROLLER = 'The environment controller is not configured or reachable on this deployment. An administrator can check it.'

function describeSlot(view: EnvironmentStateView): string {
  const slot = view.slot.ownedByThisProject ? 'held by this project' : view.slot.held ? 'held by another project' : 'free'
  return `${view.environment.observedState}; deployment slot ${slot}`
}

export function EnvironmentPanel({ engagementId, projectName }: { engagementId: string; projectName: string }): ReactElement {
  const client = useQueryClient()
  const state = useQuery({
    queryKey: ['environment', engagementId],
    queryFn: () => fetchEnvironment(engagementId),
    refetchInterval: query => refreshIntervalFor(query.state.data),
  })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [switchTo, setSwitchTo] = useState<{ holderId: string; holderName: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, not state: two clicks in the same frame must not both send.
  const inFlight = useRef(false)
  // One request id per intent: a double click or a retry after a lost answer sends the same command again.
  const intents = useRef(new Map<string, string>())

  const refresh = (): Promise<unknown> => client.invalidateQueries({ queryKey: ['environment'] })

  function begin(): boolean {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    return true
  }

  function end(): void {
    inFlight.current = false
    setBusy(false)
  }

  async function send(target: string, action: Action, expectedVersion: number): Promise<EnvironmentCommandResult> {
    const key = `${target}:${action}:${expectedVersion}`
    let requestId = intents.current.get(key)
    if (requestId === undefined) {
      requestId = `ui-${action}-${crypto.randomUUID()}`
      intents.current.set(key, requestId)
    }
    try {
      const result = await submitEnvironmentCommand(target, { requestId, action, expectedVersion })
      intents.current.delete(key)
      return result
    } catch (error) {
      if (error instanceof ApiTransportError && (error.status === 403 || error.status === 404)) throw new Error(PERMISSION)
      if (error instanceof ApiTransportError && error.status === 503) throw new Error(CONTROLLER)
      throw error
    }
  }

  async function run(action: Action, target: string, version: number): Promise<void> {
    if (!begin()) return
    try {
      const outcome = outcomeOf(action, await send(target, action, version))
      setNotice({ tone: outcome.kind === 'done' ? 'ok' : outcome.kind === 'busy' ? 'warn' : 'bad', text: outcome.message })
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'The environment command failed.' })
    } finally {
      end()
      await refresh()
    }
  }

  async function switchFrom(holderId: string, holderName: string): Promise<void> {
    if (!begin()) return
    try {
      const holder = await fetchEnvironment(holderId)
      const stopped = await send(holderId, 'stop', holder.slot.version)
      if (stopped.status !== 'accepted' && stopped.status !== 'replayed') {
        setNotice({ tone: 'warn', text: `${holderName} did not stop (${stopped.status}). Nothing was started here.` })
        return
      }
      const fresh = await fetchEnvironment(engagementId)
      const started = await send(engagementId, 'activate', fresh.slot.version)
      const outcome = outcomeOf('activate', started)
      setNotice({ tone: outcome.kind === 'done' ? 'ok' : 'bad', text: `${holderName} was stopped. ${outcome.message}` })
      setSwitchTo(null)
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'The switch failed.' })
    } finally {
      end()
      await refresh()
    }
  }

  async function askForSwitch(): Promise<void> {
    try {
      const projects = await listEngagements()
      const views = new Map<string, EnvironmentStateView>()
      for (const project of projects.slice(0, 50)) {
        if (project.id === engagementId) continue
        try {
          views.set(project.id, await fetchEnvironment(project.id))
        } catch {
          // A project this caller cannot read is not a holder it can stop; it is skipped, never guessed at.
        }
      }
      const holderId = ownHolder(views)
      if (holderId === null) {
        setNotice({ tone: 'warn', text: 'Another project holds the deployment slot and you cannot see it. Ask its owner to stop it.' })
        return
      }
      setSwitchTo({ holderId, holderName: projects.find(project => project.id === holderId)?.displayName ?? 'The running project' })
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'The projects could not be read.' })
    }
  }

  if (state.isError) {
    return (
      <Card>
        <CardHeader title="Environment" />
        <Banner tone="bad">{state.error instanceof Error ? state.error.message : 'The environment could not be read.'}</Banner>
      </Card>
    )
  }
  const view = state.data
  if (view === undefined) {
    return (
      <Card>
        <CardHeader title="Environment" />
        <p className="text-sm text-muted" aria-busy="true">Reading the environment…</p>
      </Card>
    )
  }

  const next = nextAction(view)
  const reconcile = needsReconcile(view)
  const settling = view.environment.observedState === 'starting' || view.environment.observedState === 'stopping'

  return (
    <Card>
      <CardHeader title="Environment" sub={`${projectName}: ${describeSlot(view)}`} />
      {settling && (
        <p className="text-sm" role="status" aria-live="polite">
          {view.environment.observedState === 'starting' ? 'Starting the project environment…' : 'Stopping the project environment…'}
        </p>
      )}
      {reconcile && (
        <Banner tone="warn" title="The environment state is uncertain">
          The outcome of the last change is not known. Stop the environment to reconcile it before starting again.
        </Banner>
      )}
      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
      {switchTo !== null && (
        <div className="mt-3 space-y-2" role="group" aria-label="Switch project">
          <p className="text-sm">{switchTo.holderName} is running on this deployment. Stop it and start {projectName}?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void switchFrom(switchTo.holderId, switchTo.holderName)}>
              Stop {switchTo.holderName} and switch to {projectName}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setSwitchTo(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {next === 'activate' && (
          <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void run('activate', engagementId, view.slot.version)}>
            Activate {projectName}
          </Button>
        )}
        {view.slot.held && !view.slot.ownedByThisProject && switchTo === null && (
          <Button variant="secondary" disabled={busy} onClick={() => void askForSwitch()}>
            Switch from another project
          </Button>
        )}
        {next === 'stop' && (
          <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void run('stop', engagementId, view.slot.version)}>
            {reconcile ? 'Stop to reconcile' : `Stop ${projectName}`}
          </Button>
        )}
      </div>
    </Card>
  )
}
