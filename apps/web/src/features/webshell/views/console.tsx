import { useState, type FormEvent, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { WebShellCommandView, WebShellConnectionView, WebShellProbeView } from '@raptix/web-contracts'
import { Banner, Button, Card, CardHeader, DescList, Skeleton, Status, Textarea } from '../../../ui/index'
import { messageOf, useWebShellCommands, useWebShellWrites } from '../query'
import { WebShellCommandTable } from './command-table'

const PROBE_LABEL: Record<WebShellProbeView['state'], string> = {
  reachable: 'Reachable: the probe output matched the pattern.',
  reachable_no_proof: 'Reachable: the endpoint answered, but the pattern did not match.',
  unreachable: 'Unreachable: the endpoint did not answer with a usable HTTP response.',
  unknown: 'Unknown: the probe outcome could not be determined. It was not retried.',
}

function connectionStatus(state: WebShellConnectionView['state']): { value: string; label: string } {
  if (state === 'reachable') return { value: 'passed', label: 'reachable' }
  if (state === 'unreachable') return { value: 'failed', label: 'unreachable' }
  if (state === 'closed') return { value: 'pending', label: 'closed' }
  return { value: 'pending', label: state }
}

function unresolvedOf(commands: WebShellCommandView[]): WebShellCommandView | undefined {
  return commands.find((command) => command.status === 'creating' || command.status === 'uncertain')
}

export function WebShellConsole({ engagementId, connection, canMutate }: {
  engagementId: string
  connection: WebShellConnectionView
  canMutate: boolean
}): ReactElement {
  const writes = useWebShellWrites(engagementId)
  const commands = useWebShellCommands(engagementId, connection.id)
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<WebShellProbeView | null>(null)
  const status = connectionStatus(connection.state)
  const unresolved = unresolvedOf(commands.data?.commands ?? [])
  const closed = connection.state === 'closed'
  const disabled = !canMutate || closed || unresolved !== undefined

  const probeMutation = useMutation({
    mutationFn: () => writes.probe(connection.id, crypto.randomUUID()),
    onSuccess: (result) => { setProbe(result); setError(null) },
    onError: (err) => setError(messageOf(err, 'The probe was refused or the runtime is unavailable.')),
  })
  const closeMutation = useMutation({
    mutationFn: () => writes.close(connection.id),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The connection could not be closed.')),
  })
  const execute = useMutation({
    mutationFn: () => writes.execute(connection.id, { requestId: crypto.randomUUID(), command: command.trim() }),
    onSuccess: () => { setCommand(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The command was refused by the server.')),
  })

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (command.trim() === '') { setError('Enter a command to run.'); return }
    setError(null)
    execute.mutate()
  }

  return (
    <Card>
      <CardHeader
        title={connection.name}
        sub={`${connection.profile.target} · ${connection.profile.endpoint}`}
        actions={<Status kind="gate" value={status.value} size="sm" label={status.label} />}
      />
      <div className="space-y-4 px-4 pb-4">
        <DescList
          items={[
            { k: 'Provider', v: connection.profile.provider },
            { k: 'Form parameter', v: <span className="font-mono text-xs">{connection.profile.command_parameter}</span> },
            { k: 'Probe command', v: <span className="font-mono text-xs">{connection.profile.probe_command}</span> },
            { k: 'Probe pattern', v: <span className="font-mono text-xs">{connection.profile.probe_pattern}</span> },
            { k: 'Expected user', v: connection.profile.expected_user ?? 'Not set' },
            { k: 'Source', v: connection.source === 'poc_acquisition' ? `PoC acquisition${connection.producerFindingId === null ? '' : ` · ${connection.producerFindingId}`}` : 'Manual' },
            { k: 'Last probe', v: connection.lastProbeAt === null ? 'Never' : `${connection.lastProbeState ?? 'unknown'} · ${connection.lastProbeAt}` },
          ]}
        />
        {!canMutate && (
          <Banner tone="warn" title="Read-only WebShell">
            WebShell direct access requires single-operator mode and the operator role. The server refuses create, probe and command requests.
          </Banner>
        )}
        {closed && <Banner tone="info" title="Connection closed">This connection is closed; probe and command dispatch are refused.</Banner>}
        {unresolved !== undefined && (
          <Banner tone="warn" title="Unresolved command">
            {unresolved.status === 'uncertain' ? 'The runtime outcome is uncertain and was not retried.' : 'A command is still in flight.'} Close the connection or wait for the runtime before sending another command.
          </Banner>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!canMutate || closed || probeMutation.isPending} onClick={() => probeMutation.mutate()}>
            {probeMutation.isPending ? 'Probing…' : 'Probe connection'}
          </Button>
          <Button variant="secondary" disabled={!canMutate || closed || closeMutation.isPending} onClick={() => closeMutation.mutate()}>
            {closeMutation.isPending ? 'Closing…' : 'Close connection'}
          </Button>
        </div>
        {probe !== null && (
          <Banner tone={probe.state === 'reachable' ? 'ok' : probe.state === 'unreachable' ? 'bad' : 'warn'} title="Probe result">
            {PROBE_LABEL[probe.state]} {probe.error === null ? '' : `Server: ${probe.error}`}
          </Banner>
        )}
        {error !== null && <Banner tone="bad" title="WebShell request refused">{error}</Banner>}
        <form className="space-y-3" onSubmit={submit}>
          <label className="text-sm text-muted" htmlFor="webshell-command">Command</label>
          <Textarea
            id="webshell-command"
            aria-label="WebShell command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={disabled}
            placeholder="id; hostname"
          />
          <Button type="submit" variant="primary" disabled={disabled || execute.isPending || command.trim() === ''}>
            {execute.isPending ? 'Running…' : 'Run command'}
          </Button>
        </form>
        <div>
          <h3 className="mb-2 text-sm font-medium">Command history</h3>
          {commands.isPending ? <Skeleton className="h-12" />
            : commands.isError ? <p className="text-sm text-bad" role="alert">{messageOf(commands.error, 'The command ledger is unavailable.')}</p>
            : (commands.data?.commands.length ?? 0) === 0 ? <p className="text-sm text-muted">No commands recorded on this connection.</p>
            : <WebShellCommandTable commands={commands.data?.commands ?? []} />}
        </div>
      </div>
    </Card>
  )
}
