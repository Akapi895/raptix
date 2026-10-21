import { ROLE_LABEL } from '../../domain/policy'
import { useCan, useMe, useReadOnly } from '../../state/console'
import { useProjectStore } from '../../state/stores'

/** Reason creation is not allowed (empty = allowed) */
export function useCreateReason(projectId?: string) {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const p = projectId || pid
  if (p === 'all') return 'Select a specific project before creating a finding.'
  if (readOnly(p)) return me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  if (!can('createFinding', p)) return `The ${ROLE_LABEL[me.role]} role cannot create findings.`
  return ''
}
