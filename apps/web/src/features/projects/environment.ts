/**
 * Pure decisions behind the project environment panel (ADR-0092 §1.2, §4.3). The panel shows what these return and
 * sends the commands they allow. Nothing here performs I/O.
 */

import type { EnvironmentCommandResult, EnvironmentStateView } from '@raptix/web-contracts'

/** A state that moves by itself. The panel keeps refreshing until it settles. */
export function isSettling(view: EnvironmentStateView): boolean {
  return view.environment.observedState === 'starting' || view.environment.observedState === 'stopping'
}

/** An unknown outcome. Nothing starts or switches until the owner has reconciled it by stopping. */
export function needsReconcile(view: EnvironmentStateView): boolean {
  return view.environment.observedState === 'uncertain' || view.slot.phase === 'uncertain'
}

/** The project id this caller holds the slot for, or null. Other projects are never named. */
export function ownHolder(states: ReadonlyMap<string, EnvironmentStateView>): string | null {
  for (const [engagementId, view] of states) {
    if (view.slot.ownedByThisProject) return engagementId
  }
  return null
}

/** Two-second polling while a state moves, and no polling once it settles. */
export function refreshIntervalFor(view: EnvironmentStateView | undefined): number | false {
  return view !== undefined && isSettling(view) ? 2000 : false
}

export type CommandOutcome =
  | { kind: 'done'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'refresh'; message: string }
  | { kind: 'failed'; message: string }

/** Turns a decided command answer into what the operator reads, with the next step where there is one. */
export function outcomeOf(action: 'activate' | 'stop', result: EnvironmentCommandResult): CommandOutcome {
  if (result.status === 'accepted' || result.status === 'replayed') {
    if (result.phase === 'uncertain') return { kind: 'failed', message: 'The environment state is uncertain. Stop it to reconcile before starting again.' }
    if (action === 'activate') return { kind: 'done', message: result.phase === 'ready' ? 'The environment is ready.' : 'Starting the environment. This can take a minute.' }
    return { kind: 'done', message: result.phase === 'idle' ? 'The environment is stopped.' : 'Stopping the environment.' }
  }
  if (result.status === 'busy') return { kind: 'busy', message: 'Another project is running on this deployment. Stop it, then start this one.' }
  if (result.status === 'stale') return { kind: 'refresh', message: 'The environment changed while you were looking at it. The state has been refreshed; try again.' }
  return { kind: 'failed', message: `The environment cannot change right now${result.reason ? ` (${result.reason})` : ''}.` }
}

/** The one command a state allows the owner to send next. */
export function nextAction(view: EnvironmentStateView): 'activate' | 'stop' | 'none' {
  if (view.slot.ownedByThisProject) return view.slot.phase === 'idle' ? 'none' : 'stop'
  if (view.slot.held) return 'none'
  return 'activate'
}
