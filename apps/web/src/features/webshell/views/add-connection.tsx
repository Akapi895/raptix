import { useState, type FormEvent, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { WebShellConnectionCreateInput, WebShellConnectionView, WebShellProbeView } from '@raptix/web-contracts'
import { Banner, Button, Input, Textarea } from '../../../ui/index'
import { messageOf, useWebShellWrites } from '../query'

const TARGET = /^(?:[A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:]+\])$/
const PARAMETER = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
const CONTROL = /[\u0000-\u001f\u007f]/

function hostOf(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username !== '' || url.password !== '' || url.hash !== '') return null
    return url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return null
  }
}

const normalizeTarget = (value: string): string => value.trim().toLowerCase().replace(/^\[|\]$/g, '')

function validate(name: string, target: string, endpoint: string, parameter: string, probeCommand: string, probePattern: string, expectedUser: string, userAgent: string):
  { input: WebShellConnectionCreateInput; error: null } | { input: null; error: string } {
  const cleanName = name.trim()
  if (cleanName.length < 1 || cleanName.length > 128 || CONTROL.test(cleanName)) return { input: null, error: 'The name must be 1-128 printable characters.' }
  const cleanTarget = normalizeTarget(target)
  if (!TARGET.test(target.trim()) || !cleanTarget) return { input: null, error: 'The target must be a bare host or IP address.' }
  const host = hostOf(endpoint.trim())
  if (host === null) return { input: null, error: 'The endpoint must be an http(s) URL without credentials or a fragment.' }
  if (host !== cleanTarget) return { input: null, error: 'The endpoint host must match the target.' }
  if (!PARAMETER.test(parameter.trim())) return { input: null, error: 'The command parameter must be a simple form field name.' }
  const command = probeCommand.trim()
  if (command.length < 1 || command.length > 1024 || CONTROL.test(command)) return { input: null, error: 'The probe command must be 1-1024 characters without control characters.' }
  if (probePattern.length < 4 || probePattern.length > 256 || probePattern.includes(',')) return { input: null, error: 'The probe pattern must be a single 4-256 character regex.' }
  try {
    if (new RegExp(probePattern).test('')) return { input: null, error: 'The probe pattern must not match an empty string.' }
  } catch {
    return { input: null, error: 'The probe pattern is not a valid regex.' }
  }
  const user = expectedUser.trim()
  if (user.length > 64 || CONTROL.test(user)) return { input: null, error: 'The expected user must be at most 64 printable characters.' }
  const agent = userAgent.trim()
  if (agent.length > 1024 || /[\r\n\u0000]/.test(agent)) return { input: null, error: 'The User-Agent must be at most 1024 characters.' }
  const headers = agent === '' ? undefined : { 'User-Agent': agent }
  return {
    input: {
      requestId: crypto.randomUUID(),
      name: cleanName,
      profile: {
        provider: 'http-form-command',
        target: cleanTarget,
        endpoint: endpoint.trim(),
        method: 'POST',
        content_type: 'application/x-www-form-urlencoded',
        command_parameter: parameter.trim(),
        ...(headers === undefined ? {} : { headers }),
        probe_command: command,
        probe_pattern: probePattern,
        ...(user === '' ? {} : { expected_user: user }),
      },
    },
    error: null,
  }
}

const PROBE_LABEL: Record<WebShellProbeView['state'], string> = {
  reachable: 'Reachable: the probe output matched the pattern.',
  reachable_no_proof: 'Reachable: the endpoint answered, but the probe pattern did not match.',
  unreachable: 'Unreachable: the endpoint did not answer with a usable HTTP response.',
  unknown: 'Unknown: the probe outcome could not be determined. It was not retried.',
}

export function AddWebShellConnection({ engagementId, onCreated, onCancel }: {
  engagementId: string
  onCreated: (connection: WebShellConnectionView) => void
  onCancel: () => void
}): ReactElement {
  const writes = useWebShellWrites(engagementId)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [parameter, setParameter] = useState('cmd')
  const [probeCommand, setProbeCommand] = useState('id;hostname')
  const [probePattern, setProbePattern] = useState('uid=33')
  const [expectedUser, setExpectedUser] = useState('')
  const [userAgent, setUserAgent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<WebShellProbeView | null>(null)

  const probeMutation = useMutation({
    mutationFn: ({ connectionId }: { connectionId: string }) => writes.probe(connectionId, crypto.randomUUID()),
    onSuccess: setProbe,
    onError: (err) => setError(messageOf(err, 'The connection was created, but the probe was refused or unavailable.')),
  })
  const create = useMutation({
    mutationFn: (input: WebShellConnectionCreateInput) => writes.create(input),
    onSuccess: (connection) => {
      setError(null)
      setProbe(null)
      onCreated(connection)
      probeMutation.mutate({ connectionId: connection.id })
    },
    onError: (err) => setError(messageOf(err, 'The WebShell connection was refused by the server.')),
  })

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const checked = validate(name, target, endpoint, parameter, probeCommand, probePattern, expectedUser, userAgent)
    if (checked.input === null) {
      setError(checked.error)
      return
    }
    setError(null)
    create.mutate(checked.input)
  }

  return (
    <form className="space-y-3 border-t border-line p-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted" htmlFor="webshell-name">Name
          <Input id="webshell-name" required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} placeholder="phpbash" />
        </label>
        <label className="text-sm text-muted" htmlFor="webshell-target">Target host
          <Input id="webshell-target" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10.129.88.4" />
        </label>
        <label className="text-sm text-muted sm:col-span-2" htmlFor="webshell-endpoint">Endpoint URL
          <Input id="webshell-endpoint" required value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://10.129.88.4/dev/phpbash.php" />
        </label>
        <label className="text-sm text-muted" htmlFor="webshell-parameter">Command parameter
          <Input id="webshell-parameter" required value={parameter} onChange={(e) => setParameter(e.target.value)} placeholder="cmd" />
        </label>
        <label className="text-sm text-muted" htmlFor="webshell-user">Expected user (optional)
          <Input id="webshell-user" maxLength={64} value={expectedUser} onChange={(e) => setExpectedUser(e.target.value)} placeholder="www-data" />
        </label>
        <label className="text-sm text-muted" htmlFor="webshell-probe-command">Probe command
          <Input id="webshell-probe-command" required value={probeCommand} onChange={(e) => setProbeCommand(e.target.value)} />
        </label>
        <label className="text-sm text-muted" htmlFor="webshell-probe-pattern">Probe pattern (regex)
          <Input id="webshell-probe-pattern" required value={probePattern} onChange={(e) => setProbePattern(e.target.value)} />
        </label>
        <label className="text-sm text-muted sm:col-span-2" htmlFor="webshell-user-agent">User-Agent (optional)
          <Textarea id="webshell-user-agent" className="min-h-20" maxLength={1024} value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="No browser identity is invented; leave empty unless the endpoint needs one." />
        </label>
      </div>
      {error !== null && <Banner tone="bad" title="Connection not added">{error}</Banner>}
      {probe !== null && (
        <Banner tone={probe.state === 'reachable' ? 'ok' : probe.state === 'unreachable' ? 'bad' : 'warn'} title="Probe result">
          {PROBE_LABEL[probe.state]} {probe.error === null ? '' : `Server: ${probe.error}`}
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || probeMutation.isPending}>Add connection</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
