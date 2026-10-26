import { useState, type ReactElement } from 'react'
import { Plus, TerminalSquare } from 'lucide-react'
import type { WebShellConnectionView } from '@raptix/web-contracts'
import { useIndependentReviewRequired } from '../../../state/real-context'
import { useQueryScope } from '../../../state/keys'
import { Banner, Button, Card, CardHeader, Empty, Skeleton, Status } from '../../../ui/index'
import { messageOf, useWebShellConnections } from '../query'
import { AddWebShellConnection } from './add-connection'
import { WebShellConsole } from './console'

const MUTATING_ROLES = new Set(['owner', 'operator', 'admin', 'manager'])

function stateBadge(state: WebShellConnectionView['state']): { value: string; label: string } {
  if (state === 'reachable') return { value: 'passed', label: 'reachable' }
  if (state === 'unreachable') return { value: 'failed', label: 'unreachable' }
  if (state === 'closed') return { value: 'pending', label: 'closed' }
  return { value: 'pending', label: state }
}

export function WebShellPanel({ engagementId }: { engagementId: string }): ReactElement {
  const connections = useWebShellConnections(engagementId)
  const scope = useQueryScope()
  const independentReview = useIndependentReviewRequired()
  const canMutate = !independentReview && MUTATING_ROLES.has(scope.role)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const rows = connections.data?.connections ?? []
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null

  return (
    <Card>
      <CardHeader
        title="WebShell sessions"
        sub="Manual HTTP form-command sessions. Connection state and command outcomes are recorded only after the runtime answers."
        actions={
          <Button variant="secondary" disabled={!canMutate} onClick={() => setShowAdd((open) => !open)}>
            <Plus size={14} aria-hidden="true" /> {showAdd ? 'Cancel' : 'Add connection'}
          </Button>
        }
      />
      {connections.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
        : connections.isError ? (
          <div className="p-4">
            <Banner tone="warn" title="WebShell unavailable">
              {messageOf(connections.error, 'The WebShell service is not reachable.')} No substitute connection is shown.
            </Banner>
          </div>
        ) : (
          <div>
            {showAdd && canMutate && (
              <AddWebShellConnection
                engagementId={engagementId}
                onCreated={(connection) => setSelectedId(connection.id)}
                onCancel={() => setShowAdd(false)}
              />
            )}
            {rows.length === 0 ? (
              <Empty icon={TerminalSquare} title="No WebShell connections" action={canMutate && !showAdd ? <Button onClick={() => setShowAdd(true)}>Add connection</Button> : undefined}>
                Add a manual HTTP form-command connection, then probe it before running commands.
              </Empty>
            ) : (
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <ul className="divide-y divide-line rounded-lg border border-line" aria-label="WebShell connections">
                  {rows.map((row) => {
                    const badge = stateBadge(row.state)
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          aria-current={selected?.id === row.id ? 'true' : undefined}
                          className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-hover ${selected?.id === row.id ? 'bg-subtle' : ''}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{row.name}</span>
                            <span className="rounded-full border border-line px-1.5 text-[10px] uppercase text-muted">WebShell</span>
                            <Status kind="gate" value={badge.value} size="sm" label={badge.label} />
                          </div>
                          <div className="text-xs text-muted">{row.profile.target} · {row.profile.endpoint}</div>
                          <div className="text-xs text-muted">{row.source === 'poc_acquisition' ? `From ${row.producerFindingId ?? 'a finding'}` : 'Manual connection'}</div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {selected === null ? <Empty title="No connection selected">Choose a WebShell connection.</Empty> : (
                  <WebShellConsole engagementId={engagementId} connection={selected} canMutate={canMutate} />
                )}
              </div>
            )}
          </div>
        )}
    </Card>
  )
}
