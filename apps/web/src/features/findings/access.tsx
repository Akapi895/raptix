import { AlertTriangle, Lock } from 'lucide-react'
import { FindingReadError } from './query'
import { useDelayedNav } from './delayed-nav'
import {
  Button, Empty,
} from '../../ui/index'
import { go } from '../../router/navigate'
import { useProjectStore, useUiStore } from '../../state/stores'

/* ───────────── Access handling for the finding page (ticket 31) ───────────── */
/**
 * The detail read carries the authorization decisions: a finding outside the
 * actor's access is `not-found` (indistinguishable from a missing one), and
 * a finding in an accessible project outside the active project context is
 * `forbidden` with the owning project on the entity ref — refused without
 * content, with an explicit switch offered here.
 */
export function FindingDenied({ id, error }: { id?: string; error: FindingReadError }) {
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const nav = useDelayedNav()
  const other = error.failure.kind === 'forbidden' ? error.failure.entity?.projectId : undefined
  if (other) {
    return (
      <Empty icon={Lock} title={`Finding ${id} belongs to another project`} action={<div className="flex gap-2"><Button variant="primary" onClick={() => { setPid(other); nav(() => go('finding', { id }), 80) }}>Switch to {other}</Button><Button onClick={() => setSwitcherOpen(true)}>Select another project</Button></div>}>
        The selected project is {pid}. To avoid mixing data, content from {other} is not shown in this context.
      </Empty>
    )
  }
  return <Empty icon={AlertTriangle} title="Finding not found" action={<Button onClick={() => go('findings')}>Back to findings</Button>}>ID {id || '—'} does not exist or is not available for your account.</Empty>
}
