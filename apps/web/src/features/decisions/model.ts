/**
 * Decision semantics for the task inbox (WS-2). A workflow decision is a pending review, approval or grant that a record
 * owner must act on. An active emergency stop is an attention item and is never counted as a decision (D-02). Runtime tool
 * approvals are not part of this inbox. A count from a limited read is a lower bound, and it is shown as one.
 */

export interface SplitTasks<T> {
  decisions: T[]
  stops: T[]
}

/** Separates the workflow decisions from the active emergency stops, keeping the order the read returned. */
export function splitTasks<T extends { kind: string }>(tasks: readonly T[]): SplitTasks<T> {
  const split: SplitTasks<T> = { decisions: [], stops: [] }
  for (const task of tasks) (task.kind === 'active-stop' ? split.stops : split.decisions).push(task)
  return split
}

/** Which counts a read limited. A kind that did not reach the cap is exact, so a full stop list leaves the decisions exact. */
export interface InboxLimits {
  decisions: boolean
  stops: boolean
}

export function inboxLimits(view: { limited?: boolean; limitedKinds?: readonly string[] }): InboxLimits {
  if (view.limitedKinds !== undefined) return { decisions: view.limitedKinds.some((kind) => kind !== 'active-stop'), stops: view.limitedKinds.includes('active-stop') }
  const any = view.limited === true
  return { decisions: any, stops: any }
}

/** A count as the user reads it: a count from a limited read carries a plus, because more rows may exist. */
export function countText(count: number, limited: boolean): string {
  return limited ? `${count}+` : String(count)
}
