/**
 * Counts on the project overview, each read through the feature hook that owns its source (migration Mốc 1).
 * Findings are the curated records (every status except AI suggestion); AI suggestions are proposals and sit on their own row. A failed source
 * shows "No source" for its own row only and is never shown as zero.
 */
import type { ReactElement, ReactNode } from 'react'
import { useAssetList } from '../../assets'
import { useFindingList } from '../../findings'
import { useRuntimeFleet } from '../../operations'
import { DescList } from '../../../ui/index'

/** A feature query as the counts see it: still loading, failed, or loaded with data. */
interface CountRead<T> { isPending: boolean; isError: boolean; data?: T }

function cell<T>(read: CountRead<T>, value: (data: T) => ReactNode): ReactNode {
  if (read.isPending) return '…'
  if (read.isError || read.data === undefined) return 'No source'
  return value(read.data)
}

export function ProjectCounts({ engagementId }: { engagementId: string }): ReactElement {
  const findings = useFindingList({})
  const assets = useAssetList({})
  const fleet = useRuntimeFleet(engagementId)
  return (
    <DescList
      items={[
        {
          k: 'Curated findings',
          v: cell(findings, (data) => {
            const total = Object.values(data.severity).reduce((sum, count) => sum + count, 0)
            return (
              <span>
                <span className="block">{total}</span>
                <span className="mt-1 block text-xs font-normal text-muted">
                  in review {data.awaitingReview} · confirmed {data.counts.confirmed} · resolved {data.resolved}
                </span>
              </span>
            )
          }),
        },
        {
          k: 'AI suggestions',
          v: cell(findings, (data) => (
            <span>
              <span className="block">{data.counts.ai}</span>
              <span className="mt-1 block text-xs font-normal text-muted">Proposals awaiting disposition; not findings until accepted</span>
            </span>
          )),
        },
        { k: 'Assets', v: cell(assets, (data) => String(data.total)) },
        { k: 'Active runs', v: cell(fleet, (data) => String(data.counts.activeRuns)) },
      ]}
    />
  )
}
