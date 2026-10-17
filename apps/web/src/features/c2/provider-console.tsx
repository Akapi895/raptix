/**
 * Provider console (plan P12, C2 slice): the sessions the provider reports, the
 * command dispatch form and the durable command audit. Every command authorizes
 * against a live approved grant at dispatch and again at completion, so a refusal
 * is shown in the server's words. An outcome left uncertain is reconciled, never
 * re-sent.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, TerminalSquare } from 'lucide-react'
import { utcMinute } from '../../real/format'
import { Banner, Button, Card, CardHeader, Input, Skeleton, Status } from '../../ui'
import type { C2ProviderCommand } from './provider'
import { messageOf, useProviderCommands, useProviderSurface, useProviderWrites } from './provider-query'

const COMMAND_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = { succeeded: 'ok', failed: 'bad', uncertain: 'warn', creating: 'warn' }

/** The bounded command-audit rows: status, exit code, output with its truncation flag. */
export function CommandTable({ commands }: { commands: C2ProviderCommand[] }): ReactElement {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="pb-2">Command</th><th className="pb-2">Status</th><th className="pb-2">Exit</th><th className="pb-2">Created</th>
        </tr>
      </thead>
      <tbody>
        {commands.map((c) => (
          <tr key={c.id} className="border-t border-line">
            <td className="py-2 pr-3 font-mono text-xs">{c.path} {c.args.join(' ')}</td>
            <td className="py-2 pr-3"><Status kind="gate" value={c.status === 'succeeded' ? 'passed' : c.status === 'failed' ? 'failed' : 'pending'} size="sm" label={c.status} /></td>
            <td className="py-2 pr-3 text-xs">{c.exitCode ?? '—'}</td>
            <td className="py-2 text-xs">{utcMinute(c.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ConsoleCard({ engagementId }: { engagementId: string }): ReactElement {
  const surface = useProviderSurface(engagementId)
  const commands = useProviderCommands(engagementId)
  const writes = useProviderWrites(engagementId)
  const [sessionId, setSessionId] = useState('')
  const [path, setPath] = useState('')
  const [args, setArgs] = useState('')
  const [error, setError] = useState<string | null>(null)

  const dispatch = useMutation({
    mutationFn: () => writes.dispatch({
      sessionId: sessionId.trim(),
      requestId: crypto.randomUUID(),
      path: path.trim(),
      args: args.split(' ').map((a) => a.trim()).filter((a) => a.length > 0),
    }),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The command was refused by the server (grant, session state or input bounds).')),
  })
  const reconcile = useMutation({
    mutationFn: (commandId: string) => writes.reconcile(commandId),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'Reconciliation was refused.')),
  })

  return (
    <Card>
      <CardHeader title="Provider console" sub="Sessions and command outcomes come from the real C2 provider; every command authorizes against a live approved grant at dispatch and after completion" />
      {surface.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
        : surface.isError || !surface.data ? (
          <div className="p-4">
            <Banner tone="warn" title="C2 provider unavailable">
              {messageOf(surface.error, 'The scoped provider registry is not reachable.')} No substitute session list is shown.
            </Banner>
          </div>
        ) : (
          <div className="p-4">
            {surface.data.sessions.length === 0 ? (
              <p className="text-sm text-muted">The provider reports no sessions in this engagement namespace.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2">Session</th><th className="pb-2">Host</th><th className="pb-2">User</th>
                    <th className="pb-2">OS</th><th className="pb-2">Transport</th><th className="pb-2">Last check-in</th><th className="pb-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {surface.data.sessions.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono text-xs">{s.id}</td>
                      <td className="py-2 pr-3 text-xs">{s.hostname}</td>
                      <td className="py-2 pr-3 text-xs">{s.username}</td>
                      <td className="py-2 pr-3 text-xs">{s.os}/{s.arch}</td>
                      <td className="py-2 pr-3 text-xs">{s.transport}</td>
                      <td className="py-2 pr-3 text-xs">{utcMinute(s.lastCheckin)}</td>
                      <td className="py-2"><Status kind="gate" value={s.isDead ? 'failed' : 'passed'} size="sm" label={s.isDead ? 'dead' : 'alive'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); dispatch.mutate() }}>
              <label className="text-sm text-muted" htmlFor="c2-console-session">Session id</label>
              <Input id="c2-console-session" required value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder={surface.data.sessions[0]?.id ?? 'session id'} />
              <label className="text-sm text-muted" htmlFor="c2-console-path">Absolute binary path</label>
              <Input id="c2-console-path" required value={path} onChange={(e) => setPath(e.target.value)} placeholder="/usr/bin/printf" />
              <label className="text-sm text-muted" htmlFor="c2-console-args">Arguments (space separated)</label>
              <Input id="c2-console-args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="native-output" />
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary" icon={TerminalSquare} disabled={dispatch.isPending}>
                  {dispatch.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
                  Dispatch command
                </Button>
              </div>
            </form>
          </div>
        )}

      <div className="px-4 pb-4">
        <h3 className="mb-2 text-sm font-medium">Command audit</h3>
        {commands.isPending ? <Skeleton className="h-12" />
          : commands.isError || !commands.data ? (
            <p className="text-sm text-bad" role="alert">{messageOf(commands.error, 'The command ledger is unavailable.')}</p>
          ) : commands.data.length === 0 ? (
            <p className="text-sm text-muted">No commands have been dispatched on this engagement.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Request</th><th className="pb-2">Session</th><th className="pb-2">Path</th>
                  <th className="pb-2">Status</th><th className="pb-2">Exit</th><th className="pb-2">Output</th><th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {commands.data.map((c) => <CommandRow key={c.id} command={c} onReconcile={() => reconcile.mutate(c.id)} pending={reconcile.isPending} />)}
              </tbody>
            </table>
          )}
        {error !== null && <p className="mt-2 text-sm text-bad" role="alert">{error}</p>}
      </div>
    </Card>
  )
}

function CommandRow({ command, onReconcile, pending }: { command: C2ProviderCommand; onReconcile: () => void; pending: boolean }): ReactElement {
  const tone = COMMAND_TONE[command.status] ?? 'neutral'
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-3 font-mono text-xs">{command.requestId}</td>
      <td className="py-2 pr-3 font-mono text-xs">{command.sessionId}</td>
      <td className="py-2 pr-3 font-mono text-xs">{command.path}{command.args.length > 0 ? ` ${command.args.join(' ')}` : ''}</td>
      <td className="py-2 pr-3"><Status kind="gate" value={tone === 'ok' ? 'passed' : tone === 'bad' ? 'failed' : 'pending'} size="sm" label={command.status} /></td>
      <td className="py-2 pr-3 text-xs">{command.exitCode === null ? '—' : command.exitCode}</td>
      <td className="py-2 pr-3 font-mono text-xs text-muted">{command.stdout === '' ? '—' : command.stdout.slice(0, 120)}{command.stdoutTruncated ? '…' : ''}</td>
      <td className="py-2 text-xs">
        {command.status === 'uncertain' || command.status === 'creating'
          ? <Button variant="secondary" disabled={pending} onClick={onReconcile}>Reconcile</Button>
          : <span className="text-muted">—</span>}
      </td>
    </tr>
  )
}
