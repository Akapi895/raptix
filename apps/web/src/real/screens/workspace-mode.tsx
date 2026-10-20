import type { ReactElement } from 'react'
import { cx } from '../../ui'

export type ConversationMode = 'planning' | 'execution'

/** Plan | Execute switch for one conversation; Execute stays disabled until the planning handoff is confirmed. */
export function ModeToggle({ mode, executionEnabled, executionReason, onMode }: {
  mode: ConversationMode
  executionEnabled: boolean
  executionReason: string | null
  onMode: (mode: ConversationMode) => void
}): ReactElement {
  const option = (id: ConversationMode, label: string, disabled: boolean, title?: string): ReactElement => (
    <button type="button" aria-pressed={mode === id} disabled={disabled} title={title} onClick={() => onMode(id)}
      className={cx('h-7 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        mode === id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg')}>
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Conversation mode" className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-subtle p-0.5">
      {option('planning', 'Plan', false, 'Plan the engagement with the planner')}
      {option('execution', 'Execute', !executionEnabled, executionEnabled ? 'Run the approved plan' : executionReason ?? 'Execution is not available yet')}
    </div>
  )
}

/** Per-conversation tool approval switch (default on). Dangerous methods always keep their approval. */
export function HitlSwitch({ enabled, busy, noThread = false, onChange }: { enabled: boolean; busy: boolean; noThread?: boolean; onChange: (enabled: boolean) => void }): ReactElement {
  const hint = 'Off: ordinary tool calls run without asking. Dangerous methods (DoS, brute force, destructive changes, ransomware, persistence, disabling security controls) still require approval.'
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      <span className="text-fg">Tool approval (HITL)</span>
      {noThread && <span className="text-muted">needs an execution thread</span>}
      <button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => onChange(!enabled)} title={hint}
        className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50', enabled ? 'bg-accent' : 'bg-line')}>
        <span className={cx('inline-block h-4 w-4 transform rounded-full bg-white transition', enabled ? 'translate-x-4' : 'translate-x-0.5')} aria-hidden />
        <span className="sr-only">Tool approval (HITL)</span>
      </button>
    </div>
  )
}
