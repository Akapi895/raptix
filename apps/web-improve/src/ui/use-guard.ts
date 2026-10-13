import { useStore } from '../store'

/* ───────────── Guard hook ───────────── */
/** Blocks actions on read-only projects; always with a reason */
export function useGuard(projectId?: string) {
  const s = useStore()
  const ro = s.readOnly(projectId)
  const p = s.db.projects.find((x) => x.id === (projectId || s.pid))
  const reason = !ro ? '' : s.me.role === 'viewer' ? 'The Viewer role has read-only access.' : p && p.status === 'closed' ? 'Project is closed — read-only.' : 'Project is read-only.'
  return { ro, reason }
}
