/**
 * The project overview's workspace status (page-details proposal §3.1): the
 * next step, the readiness checks and shortcuts to the sections that own the
 * work. Every state is derived in `../workspace.ts` from the reads made here;
 * a read still loading or failed shows as such, never as a zero or a default.
 */
import { useQuery } from '@tanstack/react-query'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { fetchPlanning } from '../../planning'
import { fetchScopeRevisions } from '../../scope'
import { go } from '../../../router/navigate'
import { Button, Card, CardHeader, Status } from '../../../ui/index'
import { nextProjectStep, projectStage, readinessChecks, STAGE_LABEL, type Read, type WorkspaceInput } from '../workspace'

const TAB_LABEL: Readonly<Record<string, string>> = {
  scope: 'Scope & ROE',
  planning: 'Planning',
  operations: 'Operations',
  'ai-workspace': 'AI Workspace',
  reports: 'Reports',
}

/** Shortcuts to the owning sections of one project; the same tab ids the sidebar uses. */
const SHORTCUTS: readonly { tab: string; label: string; sub: string }[] = [
  { tab: 'ai-workspace', label: 'AI Workspace', sub: 'Planning and execution conversation' },
  { tab: 'operations', label: 'Operations', sub: 'Runs, preflight and schedules' },
  { tab: 'findings', label: 'Findings', sub: 'Review and reproduce findings' },
  { tab: 'evidence', label: 'Evidence', sub: 'Captures and chain of custody' },
  { tab: 'reports', label: 'Reports', sub: 'Draft, review and export' },
]

/** The workspace inputs for one project, from the scope and planning reads the Scope and Planning sections share. */
function useWorkspaceInput(d: ProjectViewModel): WorkspaceInput {
  const scope = useQuery({ queryKey: ['real', 'scope-revisions', d.id], queryFn: () => fetchScopeRevisions(d.id) })
  const planning = useQuery({ queryKey: ['real', 'planning', d.id], queryFn: () => fetchPlanning(d.id) })
  const scopeRead: Read<{ approvedVersion: number | null }> = scope.data
    ? { state: 'loaded', value: { approvedVersion: scope.data.latestApprovedVersion } }
    : scope.isError ? { state: 'failed' } : { state: 'pending' }
  const planningRead: Read<{ ready: boolean; reasons: number }> = planning.data
    ? { state: 'loaded', value: { ready: planning.data.readiness.state === 'ready', reasons: planning.data.readiness.reasons.length } }
    : planning.isError ? { state: 'failed' } : { state: 'pending' }
  return {
    metadataVerified: d.metadataState === 'verified',
    authorizationConfirmed: d.authorizationConfirmed,
    handoffConfirmed: d.handoffConfirmedAt !== null,
    lifecycle: d.lifecycleStatus,
    scope: scopeRead,
    planning: planningRead,
  }
}

export function WorkspaceStatus({ d }: { d: ProjectViewModel }) {
  const input = useWorkspaceInput(d)
  const step = nextProjectStep(input)
  const checks = readinessChecks(input)
  return (
    <Card>
      <CardHeader title="Next step" sub={`Stage: ${STAGE_LABEL[projectStage(d.lifecycleStatus)]}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{step.title}</p>
          <p className="mt-1 text-sm text-muted">{step.why}</p>
        </div>
        <Button variant="primary" onClick={() => go('project', { id: d.id, tab: step.tab })}>Open {TAB_LABEL[step.tab] ?? step.tab}</Button>
      </div>
      <ul className="border-t border-line">
        {checks.map((check) => (
          <li key={check.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{check.label}</span>
              <span className="block text-xs text-muted">{check.detail}</span>
            </span>
            <span className="flex items-center gap-3">
              <Status
                kind="check"
                size="sm"
                value={check.state === 'met' ? 'pass' : check.state === 'open' ? 'review' : 'unknown'}
                label={check.state === 'met' ? 'Met' : check.state === 'open' ? 'Open' : 'Unavailable'}
              />
              {check.state !== 'met' && <Button size="sm" variant="secondary" onClick={() => go('project', { id: d.id, tab: check.tab })}>Open {TAB_LABEL[check.tab]}</Button>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function ProjectShortcuts({ projectId }: { projectId: string }) {
  return (
    <Card>
      <CardHeader title="Shortcuts" sub="Each one opens the section that owns the work, inside this project" />
      <ul className="divide-y divide-line">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.tab}>
            <button
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
              onClick={() => go('project', { id: projectId, tab: shortcut.tab })}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{shortcut.label}</span>
                <span className="block truncate text-xs text-muted">{shortcut.sub}</span>
              </span>
              <span aria-hidden className="text-muted">›</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
