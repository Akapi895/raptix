/**
 * Real C2 session-access panel (integration ticket 12). A connected session
 * is not an authorization: commands dispatch only under a live approved
 * grant with an absolute deadline. Operators request access, reviewers
 * decide independently; expired grants are swept server-side and shown
 * truthfully. The provider console reads the real Sliver-backed routes —
 * an unconfigured provider renders its 503 envelope, never seed data.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { KeyRound, Loader2, TerminalSquare } from 'lucide-react'
import { decideC2Grant, dispatchC2Command, fetchC2Commands, fetchC2Grants, fetchC2Sessions, reconcileC2Command, requestC2Grant } from '../api'
import type { C2CommandView } from '@raptix/web-contracts'
import { Banner, Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'

const STATUS_LABEL: Record<string, string> = {
  requested: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  revoked: 'revoked',
  expired: 'expired',
}

export function RealC2Panel({ engagementId }: { engagementId: string }): ReactElement {
  return (
    <div className="space-y-4">
      <RealC2Grants engagementId={engagementId} />
      <RealC2Console engagementId={engagementId} />
    </div>
  )
}

function RealC2Grants({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const grants = useQuery({
    queryKey: ['real', 'c2-grants', engagementId],
    queryFn: () => fetchC2Grants(engagementId),
  })
  const [sessionId, setSessionId] = useState('')
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState('4')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'c2-grants', engagementId] })
  }

  const request = useMutation({
    mutationFn: () => requestC2Grant(engagementId, {
      sessionId: sessionId.trim(),
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + Math.min(24, Math.max(1, Number(hours) || 1)) * 3_600_000).toISOString(),
    }),
    onSuccess: () => {
      setSessionId('')
      setReason('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The grant request was refused.'),
  })
  const decide = useMutation({
    mutationFn: (input: { grantId: string; decision: 'approved' | 'rejected' | 'revoked' }) => decideC2Grant(engagementId, input.grantId, input.decision),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The decision was refused.'),
  })

  if (grants.isPending) {
    return <Card><CardHeader title="C2 session access" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (grants.isError || !grants.data) {
    return <Empty icon={KeyRound} title="C2 grants are unavailable" action={<Button onClick={() => void grants.refetch()}>Retry</Button>}>
      {grants.error instanceof Error ? grants.error.message : 'The grants read failed.'}
    </Empty>
  }
  const view = grants.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="C2 session grants" sub={`Command dispatch requires a live approved grant per session — absolute deadline, no grace period (max ${view.maxGrantHours}h)`} />
        <div className="p-4">
          {view.grants.length === 0 ? (
            <p className="text-sm text-muted">No grants yet. Request session access below; a reviewer must approve before any command runs.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Session</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Requested by</th>
                  <th className="pb-2">Expires</th>
                  <th className="pb-2">Decision</th>
                </tr>
              </thead>
              <tbody>
                {view.grants.map((g) => (
                  <tr key={g.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{g.sessionId}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={g.status === 'approved' ? 'passed' : g.status === 'requested' ? 'pending' : 'failed'} size="sm" label={STATUS_LABEL[g.status] ?? g.status} /></td>
                    <td className="py-2 pr-3 text-xs text-muted">{g.reason}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{g.actorId}</td>
                    <td className="py-2 pr-3 text-xs">{g.expiresAt.replace('T', ' ').slice(0, 16) + 'Z'}</td>
                    <td className="py-2 text-xs">
                      {g.status === 'requested' ? (
                        <span className="flex gap-2">
                          <Button variant="primary" onClick={() => decide.mutate({ grantId: g.id, decision: 'approved' })}>Approve</Button>
                          <Button variant="secondary" onClick={() => decide.mutate({ grantId: g.id, decision: 'rejected' })}>Reject</Button>
                        </span>
                      ) : g.status === 'approved' ? (
                        <Button variant="secondary" onClick={() => decide.mutate({ grantId: g.id, decision: 'revoked' })}>Revoke</Button>
                      ) : (
                        <span className="text-muted">{g.reviewerId ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Request session access" sub="State the session and why; the request records the actor and an absolute expiry for independent review" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            request.mutate()
          }}
        >
          <label className="text-sm text-muted" htmlFor="c2-session">Session id</label>
          <Input id="c2-session" required value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="sess-1" />
          <label className="text-sm text-muted" htmlFor="c2-reason">Reason</label>
          <Textarea id="c2-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="whoami on web-1 for lateral check" />
          <label className="text-sm text-muted" htmlFor="c2-hours">Duration (hours, 1-24)</label>
          <Input id="c2-hours" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={KeyRound} disabled={request.isPending}>
              {request.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Request grant
            </Button>
          </div>
        </form>
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}

const COMMAND_TONE: Record<string, 'ok' | 'bad' | 'warn' | 'neutral'> = {
  succeeded: 'ok', failed: 'bad', uncertain: 'warn', creating: 'warn',
}

/** Provider console: real Sliver-backed session reads and the durable command audit. */
function RealC2Console({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const sessions = useQuery({ queryKey: ['real', 'c2-sessions', engagementId], queryFn: () => fetchC2Sessions(engagementId), retry: false })
  const commands = useQuery({ queryKey: ['real', 'c2-commands', engagementId], queryFn: () => fetchC2Commands(engagementId), refetchInterval: 15_000, retry: false })
  const [sessionId, setSessionId] = useState('')
  const [path, setPath] = useState('')
  const [args, setArgs] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['real', 'c2-commands', engagementId] })
  }

  const dispatch = useMutation({
    mutationFn: () => dispatchC2Command(engagementId, sessionId.trim(), {
      requestId: crypto.randomUUID(),
      path: path.trim(),
      args: args.split(' ').map((a) => a.trim()).filter((a) => a.length > 0),
    }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The command was refused by the server (grant, session state or input bounds).'),
  })
  const reconcile = useMutation({
    mutationFn: (commandId: string) => reconcileC2Command(engagementId, commandId),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'Reconciliation was refused.'),
  })

  return (
    <Card>
      <CardHeader title="Provider console" sub="Sessions and command outcomes come from the real C2 provider; every command authorizes against a live approved grant at dispatch and after completion" />
      {sessions.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-16" /></div>
        : sessions.isError || !sessions.data ? (
          <div className="p-4">
            <Banner tone="warn" title="C2 provider unavailable">
              {sessions.error instanceof Error ? sessions.error.message : 'The scoped provider registry is not reachable.'} No substitute session list is shown.
            </Banner>
          </div>
        ) : (
          <div className="p-4">
            {sessions.data.sessions.length === 0 ? (
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
                  {sessions.data.sessions.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono text-xs">{s.id}</td>
                      <td className="py-2 pr-3 text-xs">{s.hostname}</td>
                      <td className="py-2 pr-3 text-xs">{s.username}</td>
                      <td className="py-2 pr-3 text-xs">{s.os}/{s.arch}</td>
                      <td className="py-2 pr-3 text-xs">{s.transport}</td>
                      <td className="py-2 pr-3 text-xs">{new Date(s.lastCheckin * 1000).toISOString().replace('T', ' ').slice(0, 16)}Z</td>
                      <td className="py-2"><Status kind="gate" value={s.isDead ? 'failed' : 'passed'} size="sm" label={s.isDead ? 'dead' : 'alive'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => { e.preventDefault(); dispatch.mutate() }}
            >
              <label className="text-sm text-muted" htmlFor="c2-console-session">Session id</label>
              <Input id="c2-console-session" required value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder={sessions.data.sessions[0]?.id ?? 'session id'} />
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
            <p className="text-sm text-bad" role="alert">{commands.error instanceof Error ? commands.error.message : 'The command ledger is unavailable.'}</p>
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

function CommandRow({ command, onReconcile, pending }: { command: C2CommandView; onReconcile: () => void; pending: boolean }): ReactElement {
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
