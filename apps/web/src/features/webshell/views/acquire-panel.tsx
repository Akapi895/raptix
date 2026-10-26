import { useState } from 'react'
import { RefreshCw, Terminal, ExternalLink, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Banner, Button, Card, CardHeader, Mono } from '../../../ui/index'
import { useWebShellAcquisitions, useWebShellWrites, messageOf } from '../query'
import type { WebShellAcquisitionView } from '@raptix/web-contracts'

const STATE_LABELS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  running: { label: 'Running', tone: 'neutral' },
  succeeded: { label: 'Acquired', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  refused: { label: 'Refused', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

function AcquisitionRow({ acq }: { acq: WebShellAcquisitionView }) {
  const info = STATE_LABELS[acq.state] ?? { label: acq.state, tone: 'neutral' as const }
  const Icon = acq.state === 'succeeded' ? CheckCircle2 : acq.state === 'failed' ? XCircle : acq.state === 'refused' ? AlertTriangle : Terminal
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${info.tone === 'ok' ? 'text-good' : info.tone === 'bad' ? 'text-bad' : info.tone === 'warn' ? 'text-warn' : 'text-muted'}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{info.label}</span>
          <Mono>{acq.mode}</Mono>
          <span className="text-xs text-muted">attempt {acq.attempt}/{acq.maxAttempts}</span>
          {acq.connectionId && (
            <span className="inline-flex items-center gap-1 text-xs text-good"><ExternalLink className="size-3" />Connection created</span>
          )}
        </div>
        {acq.error && <p className="text-xs text-bad">{acq.error}</p>}
        {acq.profile && (
          <p className="text-xs text-muted">
            {acq.profile.endpoint} &middot; <Mono>{acq.profile.command_parameter}</Mono>
          </p>
        )}
        <p className="text-xs text-muted">{new Date(acq.createdAt).toLocaleString()}</p>
      </div>
    </div>
  )
}

export function WebShellAcquirePanel({ engagementId, findingId, readOnly }: { engagementId: string; findingId: string; readOnly: boolean }) {
  const { data, isLoading, error: listError } = useWebShellAcquisitions(engagementId)
  const writes = useWebShellWrites(engagementId)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acquisitions = data?.acquisitions.filter((a) => a.findingId === findingId) ?? []
  const latest = acquisitions[0] ?? null
  const canAcquire = !readOnly && !running && (latest === null || latest.state === 'failed' || latest.state === 'refused')
  const canRetry = !readOnly && !running && latest !== null && latest.state === 'failed' && latest.attempt < latest.maxAttempts

  const acquire = async () => {
    setRunning(true)
    setError(null)
    try {
      await writes.createAcquisition({ findingId, requestId: `acq-${findingId}-${Date.now()}` })
    } catch (err) {
      setError(messageOf(err, 'The acquisition failed.'))
    } finally {
      setRunning(false)
    }
  }

  const retry = async () => {
    if (latest === null) return
    setRunning(true)
    setError(null)
    try {
      await writes.retryAcquisition(latest.id)
    } catch (err) {
      setError(messageOf(err, 'The retry failed.'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader title="WebShell acquisition" sub={<span>Derive a session from the sealed PoC of <Mono>{findingId}</Mono></span>} />
      <div className="space-y-4 text-sm">
        {listError && <Banner tone="bad" title="Could not load acquisitions">{messageOf(listError, 'Unknown error')}</Banner>}
        {isLoading && <p role="status" className="text-muted">Loading acquisitions…</p>}
        {error && <Banner tone="bad" title="Acquisition error">{error}</Banner>}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Terminal} disabled={!canAcquire} onClick={() => void acquire()}>
            {running ? 'Acquiring…' : 'Acquire session'}
          </Button>
          {canRetry && (
            <Button variant="secondary" icon={RefreshCw} disabled={running} onClick={() => void retry()}>
              Retry
            </Button>
          )}
          {readOnly && <span className="text-xs text-muted">The project is read-only.</span>}
        </div>

        {acquisitions.length > 0 && (
          <div className="space-y-2">
            {acquisitions.map((acq) => <AcquisitionRow key={acq.id} acq={acq} />)}
          </div>
        )}
      </div>
    </Card>
  )
}
