import { useProjectStore } from '../../state/stores'
import { AllFindings } from './all-findings'
import { FindingList } from './list'

/** The Findings route: every accessible project at the all-projects scope, one project's list otherwise. */
export function FindingsPage() {
  const pid = useProjectStore((s) => s.pid)
  return pid === 'all' ? <AllFindings /> : <FindingList />
}
