import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Copy, Download } from 'lucide-react'
import type { FindingReproduction, FindingReproductionArtifact } from '@raptix/web-contracts'
import { Banner, Button, Card, CardHeader, DescList } from '../../ui/index'
import { useToastStore } from '../../state/stores'
import type { ServiceResult } from '../../domain/service'
import type { RetainedArtifact } from './service'

interface ReproduceSource {
  reproduction?: FindingReproduction
  producer?: { path: string; digest?: string | null; sizeBytes?: number }
}

type Action = 'copy' | 'download'

const mono = 'break-all font-mono text-xs'

/** Why the original bytes of the linked capture cannot be read for this viewer, or null when they can. */
function blockedReason(artifact: FindingReproductionArtifact): string | null {
  if (artifact.classification === null) return 'The capture is no longer retained, so its original bytes cannot be read.'
  if (artifact.classification === 'unclassified') return 'The capture is not classified yet. An owner or reviewer must classify it before its original bytes can be read.'
  return artifact.canReadOriginal ? null : 'Your role cannot read the original bytes of this capture.'
}

/** The class as a reader sees it; a capture that is no longer retained has no class. */
function classificationLabel(classification: FindingReproductionArtifact['classification']): string {
  if (classification === null) return 'No longer retained'
  return { unclassified: 'Unclassified', standard: 'Standard', sensitive: 'Sensitive' }[classification]
}

function saveOriginal(artifact: RetainedArtifact): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(artifact.bytes)], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The linked artifact and the read permission it was shown under. A change to either makes an in-flight read stale. */
function snapshotKey(artifact: FindingReproductionArtifact): string {
  return [artifact.captureId, artifact.digest, artifact.classification, artifact.canReadOriginal].join(':')
}

/**
 * Reproduction package of one finding. Every action and its message belong to one linked artifact and its read
 * permission: a read that finishes after either changed is discarded, so no stale file is copied or downloaded and no
 * old message shows against a different capture. Download saves the verified original bytes; Copy copies their UTF-8 text.
 */
export function ReproducePanel({ finding, readArtifact }: {
  finding: ReproduceSource
  readArtifact: (artifact: FindingReproductionArtifact) => Promise<ServiceResult<RetainedArtifact>>
}): ReactElement {
  const toast = useToastStore((s) => s.toast)
  const reproduction = finding.reproduction
  const artifact = reproduction?.artifact ?? null
  const key = artifact === null ? '' : snapshotKey(artifact)
  const current = useRef(key)
  current.current = key
  // Set on every mount, not only once: StrictMode runs the effect twice in development, and a result must not be dropped.
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [busy, setBusy] = useState<{ key: string; action: Action } | null>(null)
  const [notice, setNotice] = useState<{ key: string; message: string } | null>(null)
  const pending = busy !== null && busy.key === key
  const shownNotice = notice !== null && notice.key === key ? notice.message : ''

  const run = async (action: Action, ref: FindingReproductionArtifact): Promise<void> => {
    const runKey = snapshotKey(ref)
    setBusy({ key: runKey, action })
    try {
      const res = await readArtifact(ref)
      if (current.current !== runKey || !alive.current) return
      if (!res.ok) {
        setNotice({ key: runKey, message: res.failure.message })
        return
      }
      if (action === 'download') {
        setNotice(null)
        saveOriginal(res.data)
        return
      }
      if (res.data.text === null) {
        setNotice({ key: runKey, message: 'This capture is not UTF-8 text, so it cannot be copied. Download the original file instead.' })
        return
      }
      try {
        await navigator.clipboard.writeText(res.data.text)
        setNotice(null)
        toast('Copied the verified text.')
      } catch {
        setNotice({ key: runKey, message: 'The clipboard is not available in this browser.' })
      }
    } finally {
      if (alive.current) setBusy((b) => (b?.key === runKey ? null : b))
    }
  }

  const blocked = artifact === null ? null : blockedReason(artifact)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Reproduction package" sub="Recorded on this finding. Nothing here is inferred from the description or the producer source." />
        <div className="space-y-4 p-4 text-sm">
          {reproduction === undefined ? (
            <Banner tone="info" title="No reproduction package recorded">This finding predates the package, or none was added. Edit the finding to record one.</Banner>
          ) : (
            <>
              <Banner tone="warn" title="Not verified">No reproduction run is recorded. The steps are the operator's description, not a verified result.</Banner>
              <DescList items={[
                { k: 'Prerequisites', v: reproduction.prerequisites || 'Not provided' },
                { k: 'Inputs', v: reproduction.inputs || 'Not provided' },
                { k: 'Expected observation', v: reproduction.expectedObservation || 'Not provided' },
                { k: 'Limitations', v: reproduction.limitations || 'Not provided' },
                { k: 'Verification', v: 'Not recorded' },
              ]} />
              <div>
                <div className="mb-1 text-xs text-muted">Steps</div>
                {reproduction.steps.length === 0 ? <p>Not provided</p> : (
                  <ol className="list-decimal space-y-1 pl-5">{reproduction.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                )}
              </div>
              {artifact === null ? (
                <p className="text-muted">No reproduction artifact is linked.</p>
              ) : (
                <div className="space-y-3">
                  <DescList items={[
                    { k: 'Artifact', v: artifact.filename ?? 'Restricted capture' },
                    { k: 'Classification', v: classificationLabel(artifact.classification) },
                    { k: 'Recorded SHA-256', v: <span className={mono}>{artifact.digest}</span> },
                    { k: 'Size', v: `${artifact.sizeBytes} bytes` },
                  ]} />
                  {blocked !== null && <Banner tone="info" title="Original bytes unavailable">{blocked}</Banner>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" icon={Copy} disabled={pending || blocked !== null} onClick={() => void run('copy', artifact)}>Copy text</Button>
                    <Button variant="secondary" icon={Download} disabled={pending || blocked !== null} onClick={() => void run('download', artifact)}>Download original</Button>
                  </div>
                </div>
              )}
            </>
          )}
          {shownNotice !== '' && <p role="alert" className="text-xs text-bad">{shownNotice}</p>}
        </div>
      </Card>
      {finding.producer && (
        <Card>
          <CardHeader title="Producer source" sub="The runtime's claim source. It records what was claimed; it is not a reproduction artifact." />
          <div className="p-4 text-sm">
            <DescList items={[
              { k: 'Path', v: <span className={mono}>{finding.producer.path}</span> },
              { k: 'SHA-256', v: finding.producer.digest ? <span className={mono}>{finding.producer.digest}</span> : 'Not recorded' },
            ]} />
          </div>
        </Card>
      )}
    </div>
  )
}
