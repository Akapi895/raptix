import type { ReactElement } from 'react'
import { go } from '../../router/navigate'
import { Button } from '../../ui'

/** Keeps the legacy producer panel pointed at the shared Evidence workflow instead of offering a duplicate upload path. */
export function CaptureUpload({ engagementId }: { engagementId: string }): ReactElement {
  return (
    <div role="status" className="rounded-xl border border-line bg-subtle p-4 text-sm">
      <p className="text-muted">Retained captures are uploaded and classified in the shared Evidence workflow for this engagement.</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => go('evidence', { engagementId })}>Open Evidence inventory</Button>
    </div>
  )
}
