import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { Banner, Button, Card, CardHeader, Field, Input, Mono } from '../../ui/index'
import { fetchSealedPoc, reproduceSealedPoc, type Reproduction, type SealedPoc } from './sealed-poc-api'

const mono = 'whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-3 font-mono text-xs'
/** Long text such as a whole PoC file or a full output: scrolls inside its box instead of pushing the page down. */
const full = `${mono} max-h-[28rem] overflow-auto`

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

/** The workspace finding a producer path names, such as FIND-001 from findings/FIND-001.md; null when there is none. */
function workspaceRef(producerPath: string | undefined): string | null {
  return producerPath?.match(/FIND-\d{3}/)?.[0] ?? null
}

/**
 * The sealed PoC of this finding and a reproduction of it (ADR-0104). A reproduction runs the sealed commands once through
 * the same gates as the verifier, and it does not change the finding's status: only the verifier records a verdict.
 */
export function SealedPocPanel({ engagementId, producerPath, readOnly }: { engagementId: string; producerPath: string | undefined; readOnly: boolean }) {
  const ref = workspaceRef(producerPath)
  const [poc, setPoc] = useState<SealedPoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runTimeValue, setRunTimeValue] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Reproduction | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    if (ref === null) return
    let active = true
    setPoc(null)
    setResult(null)
    setLoadError(null)
    fetchSealedPoc(engagementId, ref)
      .then((view) => { if (active) setPoc(view) })
      .catch((error: unknown) => { if (active) setLoadError(messageOf(error, 'The sealed PoC could not be read.')) })
    return () => { active = false }
  }, [engagementId, ref])

  if (ref === null) {
    return <Card><CardHeader title="Sealed proof of concept" /><p className="text-sm text-muted">This finding was not produced from a workspace finding file, so it has no sealed PoC to reproduce.</p></Card>
  }

  const runnable = poc?.status === 'sealed' && !readOnly && !running && (!poc.run_time_value || runTimeValue !== '')

  const run = async () => {
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      setResult(await reproduceSealedPoc(engagementId, ref, runTimeValue))
    } catch (error) {
      setRunError(messageOf(error, 'The reproduction did not run.'))
    } finally {
      setRunning(false)
      setRunTimeValue('')
    }
  }

  return (
    <Card>
      <CardHeader title="Sealed proof of concept" sub={<span>Reproduces <Mono>{ref}</Mono> from <Mono>findings/{ref}.md</Mono></span>} />
      <div className="space-y-4 text-sm">
        {loadError && <Banner tone="bad" title="The sealed PoC could not be read">{loadError}</Banner>}
        {!loadError && poc === null && <p role="status" className="text-muted">Reading the sealed PoC from the project sandbox…</p>}
        {poc?.status === 'no_poc_block' && <p className="text-muted">No sealed PoC block is recorded for this finding yet.</p>}
        {poc?.status === 'refused' && <Banner tone="warn" title="The sealed PoC does not verify">{poc.refusal}</Banner>}
        {poc?.status === 'sealed' && (
          <>
            <div><div className="mb-1 text-xs text-muted">PoC file · <Mono>{poc.file}</Mono>{poc.source_truncated ? ' · first 64 KiB shown' : ''}</div><pre className={full}>{poc.source}</pre></div>
            <div><div className="mb-1 text-xs text-muted">Payload, inline in the command</div><pre className={mono}>{poc.payload}</pre></div>
            <div><div className="mb-1 text-xs text-muted">Command, run once for the positive check</div><pre className={mono}>{poc.command}</pre></div>
            <div><div className="mb-1 text-xs text-muted">Baseline command, the same with the payload removed</div><pre className={mono}>{poc.negative_command}</pre></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="mb-1 text-xs text-muted">Success patterns</div><pre className={mono}>{poc.success_patterns?.join('\n')}</pre></div>
              <div><div className="mb-1 text-xs text-muted">Baseline patterns</div><pre className={mono}>{poc.negative_patterns?.join('\n')}</pre></div>
            </div>
            {poc.run_time_value && (
              <Field label="Run-time value" required hint="One token of letters, digits and ._+/=:@%-. It is used for this run only and is not stored.">
                <Input type="password" autoComplete="off" value={runTimeValue} onChange={(event) => setRunTimeValue(event.target.value)} disabled={running} />
              </Field>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Play} disabled={!runnable} title={readOnly ? 'The project is read-only.' : poc?.status !== 'sealed' ? 'Only a sealed PoC can run.' : poc.run_time_value && runTimeValue === '' ? 'Enter the run-time value first.' : 'Run the sealed PoC once'} onClick={() => void run()}>
            {running ? 'Running…' : 'Run'}
          </Button>
          <span className="text-xs text-muted">A run does not change this finding’s status. Only the verifier records a verdict.</span>
        </div>
        {runError && <Banner tone="bad" title="The reproduction did not run">{runError}</Banner>}
        {result?.outcome === 'refused' && <Banner tone="warn" title="The reproduction was refused">{result.refusal}</Banner>}
        {result?.outcome === 'ran' && (
          <div className="space-y-3">
            <Banner tone={result.reproduced ? 'ok' : 'warn'} title={result.reproduced ? 'The sealed PoC reproduced' : 'The sealed PoC did not reproduce'}>
              {result.recorded_at ? `Recorded ${result.recorded_at}.` : null}
            </Banner>
            <div><div className="mb-1 text-xs text-muted">Positive run · exit {result.positive?.exit_code} · matched {result.positive?.matched_patterns.join(', ') || 'nothing'}</div><pre className={full}>{result.positive?.output}</pre></div>
            <div><div className="mb-1 text-xs text-muted">Baseline run · exit {result.negative?.exit_code} · matched {result.negative?.matched_patterns.join(', ') || 'nothing'}</div><pre className={full}>{result.negative?.output}</pre></div>
          </div>
        )}
      </div>
    </Card>
  )
}
