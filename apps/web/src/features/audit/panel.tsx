/**
 * Engagement audit panel (plan P09, Vault/Audit slice). Projects the
 * engagement's authoritative audit records, web workflow entries plus the vault
 * lifecycle, with the attribution the records carry. Vault rows have no actor
 * and render "not recorded" instead of a fabricated name.
 */
import { useState, type ReactElement } from 'react'
import { ScrollText } from 'lucide-react'
import { useMemberLabels } from '../../real/member-labels'
import { AuditTable } from './table'
import { Button, Card, CardHeader, Empty, Input, Skeleton } from '../../ui'
import { useAuditRead } from './query'

export function AuditPanel({ engagementId }: { engagementId: string }): ReactElement {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const memberLabel = useMemberLabels(engagementId)
  const audit = useAuditRead({ action: action || undefined, q: q || undefined })
  return (
    <Card>
      <CardHeader title="Audit" sub="Consequential actions on this engagement, recorded server-side with actor, scope, reason and timestamp" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Filter by action prefix" placeholder="action prefix, e.g. scope." value={action} onChange={(e) => setAction(e.target.value)} className="max-w-56" />
          <Input aria-label="Search audit entries" placeholder="search action / target / reason" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-72" />
        </div>
        {audit.isPending ? <Skeleton className="h-40" /> : audit.isError || !audit.data ? (
          <Empty icon={ScrollText} title="The audit log is unavailable" action={<Button onClick={() => void audit.refetch()}>Retry</Button>}>
            {audit.error instanceof Error ? audit.error.message : 'The audit read failed.'}
          </Empty>
        ) : (
          <>
            {audit.data.truncated && <p className="text-xs text-muted" role="note">Showing the newest {audit.data.entries.length} of {audit.data.total} matching entries; narrow the filters for more.</p>}
            <AuditTable entries={audit.data.entries} labelFor={memberLabel} />
          </>
        )}
      </div>
    </Card>
  )
}
