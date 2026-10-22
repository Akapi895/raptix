import { AlertTriangle } from 'lucide-react'
import { Button, Empty } from '../../../ui/index'
import { ReportReadError } from '../query'

/** Read failure of a reports list or template read, with a retry. */
export function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Empty icon={AlertTriangle} title="Could not load reports" action={<Button onClick={retry}>Retry</Button>}>
      {error instanceof ReportReadError ? error.failure.message : 'The report catalog is temporarily unavailable.'}
    </Empty>
  )
}
