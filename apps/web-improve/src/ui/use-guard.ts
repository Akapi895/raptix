import { useDb, useMe, useReadOnly } from '../state/console'
import { useProjectStore } from '../state/stores'

/* ───────────── Guard hook ───────────── */
/** Blocks actions on read-only projects; always with a reason */
export function useGuard(projectId?: string) {
  const readOnly = useReadOnly()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const db = useDb()
  const ro = readOnly(projectId)
  const p = db.projects.find((x) => x.id === (projectId || pid))
  const reason = !ro ? '' : me.role === 'viewer' ? 'The Viewer role has read-only access.' : p && p.status === 'closed' ? 'Project is closed — read-only.' : 'Project is read-only.'
  return { ro, reason }
}
