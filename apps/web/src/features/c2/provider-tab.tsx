/**
 * C2 provider tab (plan P12, C2 slice), shared by the real project detail and the
 * real feature routes. A connected session is not an authorization: commands
 * dispatch only under a live approved grant. The session and channel routes read
 * one owned resource from the provider; an id outside the engagement namespace is
 * not found, never substituted. An unconfigured provider shows its refusal, never
 * seed data.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { TerminalSquare } from 'lucide-react'
import { go, useRoute } from '../../router/navigate'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, Empty, Input, Skeleton, Status } from '../../ui/index'
import { CommandTable } from './provider-console'
import { C2SessionsWorkspace } from './session-workspace'
import { messageOf, useProviderCommands, useProviderSurface, useProviderWrites } from './provider-query'

export function C2ProviderTab({ engagementId }: { engagementId: string }): ReactElement {
  const route = useRoute()
  // A detail route consumes the resource id from the URL; unknown or foreign ids never render the full console.
  if (route.page === 'c2-session' && route.id) return <SessionDetail engagementId={engagementId} sessionId={route.id} />
  if (route.page === 'c2-channel' && route.id) return <ChannelDetail engagementId={engagementId} transport={route.id} />
  return (
    <div className="space-y-4">
      <C2SessionsWorkspace engagementId={engagementId} />
      <InfrastructureCard engagementId={engagementId} />
    </div>
  )
}

/** One owned session: its attributes and its own command audit. */
function SessionDetail({ engagementId, sessionId }: { engagementId: string; sessionId: string }): ReactElement {
  const surface = useProviderSurface(engagementId)
  const commands = useProviderCommands(engagementId)
  const session = surface.data?.sessions.find((s) => s.id === sessionId)
  const sessionCommands = (commands.data ?? []).filter((c) => c.sessionId === sessionId)
  return (
    <Card>
      <CardHeader title={`C2 session ${sessionId}`} sub="Reads the real provider registry; a session id outside this engagement namespace is not found, never substituted" />
      {surface.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-12" /></div>
        : surface.isError || !surface.data ? (
          <div className="p-4">
            <Banner tone="warn" title="C2 provider unavailable">
              {messageOf(surface.error, 'The scoped provider registry is not reachable.')} No substitute session view is shown.
            </Banner>
          </div>
        )
        : session === undefined ? (
          <Empty icon={TerminalSquare} title="Session not found" action={<Button onClick={() => go('c2', { engagementId })}>Open the C2 console</Button>}>
            The provider reports no session <span className="font-mono">{sessionId}</span> in this engagement namespace.
          </Empty>
        ) : (
          <div className="p-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <dt className="text-muted">Host</dt><dd className="text-xs font-mono">{session.hostname}</dd>
              <dt className="text-muted">User</dt><dd className="text-xs">{session.username}</dd>
              <dt className="text-muted">Platform</dt><dd className="text-xs">{session.os}/{session.arch}</dd>
              <dt className="text-muted">Transport / active channel</dt><dd className="text-xs">{session.transport} / {session.activeC2}</dd>
              <dt className="text-muted">Remote address</dt><dd className="text-xs font-mono">{session.remoteAddress}</dd>
              <dt className="text-muted">Listener port</dt><dd className="text-xs">{session.listenerPort}</dd>
              <dt className="text-muted">Last check-in</dt><dd className="text-xs">{utcMinute(session.lastCheckin)}</dd>
              <dt className="text-muted">State</dt><dd><Status kind="gate" value={session.isDead ? 'failed' : 'passed'} size="sm" label={session.isDead ? 'dead' : 'alive'} /></dd>
            </dl>
          </div>
        )}
      {session !== undefined && (
        <div className="border-t border-line p-4">
          <h3 className="mb-2 text-sm font-medium">Command audit for this session</h3>
          {commands.isPending ? <Skeleton className="h-10" />
            : commands.isError ? <p className="text-sm text-bad" role="alert">{messageOf(commands.error, 'The command ledger is unavailable.')}</p>
            : sessionCommands.length === 0 ? <p className="text-sm text-muted">No commands recorded for this session.</p>
            : <CommandTable commands={sessionCommands} />}
        </div>
      )}
    </Card>
  )
}

/** A transport channel: the sessions observed on it. The id names a transport and is never reused as a session id. */
function ChannelDetail({ engagementId, transport }: { engagementId: string; transport: string }): ReactElement {
  const surface = useProviderSurface(engagementId)
  const onChannel = (surface.data?.sessions ?? []).filter((s) => s.transport === transport)
  return (
    <Card>
      <CardHeader title={`C2 channel ${transport}`} sub="A channel id names a transport, never a session; sessions are listed by their observed transport only" />
      {surface.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-12" /></div>
        : surface.isError || !surface.data ? (
          <div className="p-4">
            <Banner tone="warn" title="C2 provider unavailable">
              {messageOf(surface.error, 'The scoped provider registry is not reachable.')} No substitute channel view is shown.
            </Banner>
          </div>
        )
        : onChannel.length === 0 ? (
          <Empty icon={TerminalSquare} title="No sessions on this channel" action={<Button onClick={() => go('c2', { engagementId })}>Open the C2 console</Button>}>
            The provider reports no session transported over <span className="font-mono">{transport}</span> in this engagement namespace.
          </Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Session</th><th className="pb-2">Host</th><th className="pb-2">State</th><th className="pb-2">Last check-in</th>
              </tr>
            </thead>
            <tbody>
              {onChannel.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono text-xs">{s.id}</td>
                  <td className="py-2 pr-3 text-xs">{s.hostname}</td>
                  <td className="py-2 pr-3"><Status kind="gate" value={s.isDead ? 'failed' : 'passed'} size="sm" label={s.isDead ? 'dead' : 'alive'} /></td>
                  <td className="py-2 text-xs">{utcMinute(s.lastCheckin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Card>
  )
}

/** Listeners and lab profiles in the provider's registry (isolated lab): start, stop by job id, create a profile. */
export function InfrastructureCard({ engagementId }: { engagementId: string }): ReactElement {
  const surface = useProviderSurface(engagementId)
  const writes = useProviderWrites(engagementId)
  const [profileName, setProfileName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startListener = useMutation({
    mutationFn: (protocol: 'mtls' | 'http') => writes.startListener(protocol),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The listener start was refused or the provider is unavailable.')),
  })
  const stop = useMutation({
    mutationFn: (jobId: number) => writes.stopListener(jobId),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The listener stop was refused.')),
  })
  const createProfile = useMutation({
    mutationFn: () => writes.createProfile(profileName.trim()),
    onSuccess: () => { setProfileName(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The profile creation was refused.')),
  })

  return (
    <Card>
      <CardHeader title="Listeners & profiles" sub="Real provider registry (isolated lab): start an mTLS or HTTP listener, stop by job id, and create lab HTTP profiles" />
      {surface.isPending ? <div className="p-4" aria-busy="true" role="status"><Skeleton className="h-12" /></div>
        : surface.isError || !surface.data ? (
          <div className="p-4">
            <Banner tone="warn" title="C2 provider unavailable">
              {messageOf(surface.error, 'The scoped provider registry is not reachable.')} No substitute listener state is shown.
            </Banner>
          </div>
        ) : (
          <div className="p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Listeners</th><th className="pb-2">State</th><th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {surface.data.listeners.length === 0 ? (
                  <tr><td colSpan={3} className="py-2 text-xs text-muted">No active listeners.</td></tr>
                ) : surface.data.listeners.map((l) => (
                  <tr key={l.jobId} className="border-t border-line">
                    <td className="py-2 pr-3 text-xs">{l.protocol} · port {l.port} · job {l.jobId}</td>
                    <td className="py-2 pr-3"><Status kind="gate" value={l.active ? 'passed' : 'failed'} size="sm" label={l.active ? 'active' : 'stopped'} /></td>
                    <td className="py-2"><Button variant="secondary" disabled={!l.active || stop.isPending} onClick={() => stop.mutate(l.jobId)}>Stop listener {l.jobId}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={startListener.isPending} onClick={() => startListener.mutate('mtls')}>Start mTLS listener</Button>
              <Button variant="secondary" disabled={startListener.isPending} onClick={() => startListener.mutate('http')}>Start HTTP listener</Button>
            </div>
            {surface.data.profiles.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                Profiles: {surface.data.profiles.map((p) => `${p.name} (${p.userAgent})`).join(' · ')}
              </p>
            )}
            <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); createProfile.mutate() }}>
              <label className="text-sm text-muted" htmlFor="c2-profile-name">Profile name
                <Input id="c2-profile-name" required maxLength={48} pattern="[a-z0-9-]{1,48}" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="lab-profile" />
              </label>
              <div className="flex items-end">
                <Button type="submit" variant="secondary" disabled={createProfile.isPending}>Create profile</Button>
              </div>
            </form>
          </div>
        )}
      {error !== null && <p className="px-4 pb-4 text-sm text-bad" role="alert">{error}</p>}
    </Card>
  )
}
