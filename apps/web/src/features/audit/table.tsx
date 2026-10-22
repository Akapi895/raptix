/**
 * The audit table shared by the engagement audit and the workspace audit. A
 * record with no actor (vault lifecycle rows) reads "not recorded", and a
 * record outside the engagement names its scope as the workspace.
 */
import type { ReactElement } from 'react'
import type { AuditEntryView } from './api';
import { go } from '../../router/navigate'
import { Status } from '../../ui/index'
import { utcMinute } from '../../platform/format'

/** `labelFor` resolves an actor id to a name where the caller can (engagement members); by default the id is shown as recorded. */
export function AuditTable({ entries, labelFor = (actorId: string) => actorId }: { entries: readonly AuditEntryView[]; labelFor?: (actorId: string) => string }): ReactElement {
  if (entries.length === 0) return <p className="text-sm text-muted">No audit entries match.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2">When</th>
          <th className="pb-2">Action</th>
          <th className="pb-2">Actor</th>
          <th className="pb-2">Scope</th>
          <th className="pb-2">Reason</th>
          <th className="pb-2">Source</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-t border-line align-top">
            <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">{utcMinute(e.createdAt)}</td>
            <td className="py-2 pr-3 font-mono text-xs text-fg">{e.action}</td>
            <td className="py-2 pr-3 text-xs" title={e.actorId ?? undefined}>{e.actorId === null ? <span className="text-muted">not recorded</span> : labelFor(e.actorId)}</td>
            <td className="py-2 pr-3 text-xs">
              {e.engagementId === null ? <span className="text-muted">workspace</span> : (
                <button className="font-mono text-xs text-fg hover:text-accent hover:underline" onClick={() => go('project', { id: e.engagementId as string })}>{e.engagementId}</button>
              )}
              {e.targetType !== null && <span className="text-muted"> · {e.targetType}</span>}
            </td>
            <td className="py-2 pr-3 text-xs">{e.reason ?? <span className="text-muted">—</span>}</td>
            <td className="py-2 text-xs"><Status kind="gate" value={e.source === 'vault' ? 'pending' : 'passed'} size="sm" label={e.source} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
