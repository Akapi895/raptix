/**
 * The Sessions workspace over the real C2 provider: the connections on the left, the selected session's tabs on the right.
 * Commands are single-shot and dispatch only under the actor's live approved grant; the server decides every grant and
 * refusal. PTY and file transfer are not offered because the provider does not support them. The provider reports only C2
 * sessions, so the WebShell filter names that no WebShell provider is registered.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { go } from '../../router/navigate'
import { useQueryScope } from '../../state/keys'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, DescList, Empty, Input, Segmented, Skeleton, Status, Textarea } from '../../ui/index'
import type { C2ProviderCommand, C2ProviderGrant, C2ProviderSession } from './provider'
import { CommandTable } from './provider-console'
import { messageOf, useProviderCommands, useProviderGrants, useProviderSurface, useProviderWrites } from './provider-query'
import { assetLinkOf, connectionOf, filterSessions, myAccessOf, type AssetLink, type KindFilter, type MyAccess, type StateFilter } from './session-access'
import type { Asset } from '../../domain/entities'
import { useAssetList } from '../assets'

const SCOPE_TEXT: Record<Asset['scope'], string> = { in: 'in scope', out: 'out of scope', pending: 'pending', unclassified: 'unclassified' }

type DetailTab = 'overview' | 'console' | 'files' | 'activity' | 'evidence' | 'access'

const KIND_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'c2', label: 'C2' },
  { id: 'webshell', label: 'WebShell' },
]

const STATE_OPTIONS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'Any state' },
  { id: 'alive', label: 'Connected' },
  { id: 'dead', label: 'Dead' },
]

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'console', label: 'Console' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Commands & Activity' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'access', label: 'Access & Policy' },
]

export function C2SessionsWorkspace({ engagementId }: { engagementId: string }): ReactElement {
  const surface = useProviderSurface(engagementId)
  const grants = useProviderGrants(engagementId)
  const commands = useProviderCommands(engagementId)
  const inventory = useAssetList({})
  const [kind, setKind] = useState<KindFilter>('all')
  const [state, setState] = useState<StateFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (surface.isPending) return <Card><div className="p-4" aria-busy="true" role="status"><Skeleton className="h-24" /></div></Card>
  if (surface.isError || !surface.data) {
    return (
      <Banner tone="warn" title="C2 provider unavailable">
        {messageOf(surface.error, 'The scoped provider registry is not reachable.')} No substitute session list is shown.
      </Banner>
    )
  }
  const sessions = surface.data.sessions
  const visible = filterSessions(sessions, { kind, state, query })
  const selected = sessions.find((session) => session.id === selectedId) ?? visible[0] ?? null

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Segmented<KindFilter> value={kind} onChange={setKind} options={KIND_OPTIONS} />
          <Segmented<StateFilter> value={state} onChange={setState} options={STATE_OPTIONS} />
          <Input aria-label="Search sessions" placeholder="Search by session, host, user, C2 or transport" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
        </div>
        <p className="px-4 pb-4 text-xs text-muted">No WebShell provider is registered in this deployment, so no WebShell connection can appear here.</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader title="Connections" sub={`${visible.length} of ${sessions.length} shown`} />
          {visible.length === 0 ? (
            <p className="p-4 text-sm text-muted">{sessions.length === 0 ? 'The provider reports no sessions in this engagement namespace.' : 'No session matches these filters.'}</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(session.id)}
                    aria-current={selected?.id === session.id ? 'true' : undefined}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-hover ${selected?.id === session.id ? 'bg-subtle' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-fg">{session.id}</span>
                      <span className="rounded-full border border-line px-1.5 text-[10px] uppercase text-muted">C2</span>
                      <Status kind="gate" value={connectionOf(session) === 'alive' ? 'passed' : 'failed'} size="sm" label={connectionOf(session) === 'alive' ? 'Connected' : 'Dead'} />
                    </div>
                    <div className="text-sm">{session.hostname} · {session.username}</div>
                    <div className="text-xs text-muted">{session.activeC2} · {session.transport} · last check-in {utcMinute(session.lastCheckin)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected === null ? <Empty title="No session selected">Choose a connection to see its overview, console and access.</Empty> : (
          <SessionDetail engagementId={engagementId} session={selected} assets={inventory.data?.items.map((item) => item.asset) ?? null} inventoryError={inventory.isError ? messageOf(inventory.error, 'The inventory could not be read.') : null} grants={grants.data?.grants ?? []} bounds={grants.data?.bounds ?? null} grantsError={grants.isError ? messageOf(grants.error, 'The grants could not be read.') : null} commands={commands.data ?? []} commandsError={commands.isError ? messageOf(commands.error, 'The command ledger is unavailable.') : null} />
        )}
      </div>
    </div>
  )
}

function SessionDetail({ engagementId, session, assets, inventoryError, grants, bounds, grantsError, commands, commandsError }: {
  engagementId: string
  session: C2ProviderSession
  /** The project's inventory assets; null while they are read. */
  assets: Asset[] | null
  inventoryError: string | null
  grants: C2ProviderGrant[]
  bounds: { minHours: number; maxHours: number } | null
  grantsError: string | null
  commands: C2ProviderCommand[]
  commandsError: string | null
}): ReactElement {
  const [tab, setTab] = useState<DetailTab>('overview')
  const scope = useQueryScope()
  const access: MyAccess = grantsError !== null ? { key: 'none', label: 'Unknown — the grants could not be read', until: null } : myAccessOf(grants, session.id, scope.actor, Date.now())
  const alive = connectionOf(session) === 'alive'
  const sessionCommands = commands.filter((command) => command.sessionId === session.id)
  const link: AssetLink | null = assets === null ? null : assetLinkOf(session, assets)

  return (
    <Card>
      <CardHeader
        title={`C2 session ${session.id}`}
        sub={`${session.hostname} · ${session.username}`}
        actions={<Status kind="gate" value={alive ? 'passed' : 'failed'} size="sm" label={alive ? 'Connected' : 'Dead'} />}
      />
      <div className="space-y-4 px-4 pb-4">
        <Segmented<DetailTab> value={tab} onChange={setTab} options={DETAIL_TABS} />
        {tab === 'overview' && <OverviewTab session={session} access={access} link={link} inventoryError={inventoryError} />}
        {tab === 'console' && <ConsoleTab engagementId={engagementId} session={session} access={access} recent={sessionCommands.slice(0, 5)} onRequest={() => setTab('access')} />}
        {tab === 'files' && (
          <Empty title="Files are not available for this session">
            This provider has no file adapter, so the console cannot list, upload or download files on {session.hostname}.
          </Empty>
        )}
        {tab === 'activity' && <ActivityTab commands={sessionCommands} error={commandsError} />}
        {tab === 'evidence' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">The provider does not report retained captures or transcripts for sessions. Evidence collected in this project is listed in the Evidence tab.</p>
            <Button variant="secondary" onClick={() => go('project', { id: engagementId, tab: 'evidence' })}>Open project evidence</Button>
          </div>
        )}
        {tab === 'access' && <AccessTab engagementId={engagementId} session={session} access={access} grants={grants.filter((grant) => grant.sessionId === session.id)} bounds={bounds} grantsError={grantsError} />}
      </div>
    </Card>
  )
}

function OverviewTab({ session, access, link, inventoryError }: {
  session: C2ProviderSession
  access: MyAccess
  link: AssetLink | null
  inventoryError: string | null
}): ReactElement {
  return (
    <div className="space-y-4">
      <DescList
        items={[
          { k: 'Session ID', v: <span className="font-mono text-xs">{session.id}</span> },
          { k: 'Kind', v: 'C2 · provider-backed' },
          { k: 'Provider', v: session.activeC2 },
          { k: 'Transport', v: session.transport },
          { k: 'Asset', v: <AssetLinkText session={session} link={link} inventoryError={inventoryError} /> },
          { k: 'Remote address', v: <span className="font-mono text-xs">{session.remoteAddress}</span> },
          { k: 'Listener port', v: String(session.listenerPort) },
          { k: 'Platform', v: `${session.os}/${session.arch}` },
          { k: 'Last check-in', v: utcMinute(session.lastCheckin) },
          { k: 'Producing operation', v: 'Not recorded by the provider' },
        ]}
      />
      <div className="rounded-lg border border-line p-4">
        <div className="text-xs font-medium text-muted">Connection and your access are separate</div>
        <DescList
          items={[
            { k: 'Connection', v: <Status kind="gate" value={connectionOf(session) === 'alive' ? 'passed' : 'failed'} size="sm" label={connectionOf(session) === 'alive' ? 'Connected' : 'Dead'} /> },
            { k: 'Your access', v: access.label },
          ]}
        />
      </div>
      <div className="rounded-lg border border-line p-4">
        <div className="text-xs font-medium text-muted">Capabilities of this provider</div>
        <DescList
          items={[
            { k: 'Single-shot commands', v: 'Available under an approved grant' },
            { k: 'Interactive PTY', v: 'Not supported by this provider' },
            { k: 'Files', v: 'Not supported by this provider' },
            { k: 'Controller', v: 'Not reported; commands take no exclusive lease' },
          ]}
        />
      </div>
    </div>
  )
}

/** The asset a session's host matches, with how it matched; the provider reports no asset id, so no match is ever assumed. */
function AssetLinkText({ session, link, inventoryError }: { session: C2ProviderSession; link: AssetLink | null; inventoryError: string | null }): ReactElement {
  if (inventoryError !== null) return <span>Unknown — the inventory could not be read: {inventoryError}</span>
  if (link === null) return <span>Reading the asset inventory…</span>
  if (link.status === 'none') return <span>No inventory asset matches {session.hostname} by name or address</span>
  if (link.status === 'ambiguous') return <span>{link.count} inventory assets match {session.hostname}; none is linked</span>
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{link.asset.name} · {SCOPE_TEXT[link.asset.scope]} · matched by {link.by}</span>
      <Button size="sm" variant="ghost" onClick={() => go('asset', { id: link.asset.id })}>Open asset</Button>
    </span>
  )
}

function ConsoleTab({ engagementId, session, access, recent, onRequest }: {
  engagementId: string
  session: C2ProviderSession
  access: MyAccess
  recent: C2ProviderCommand[]
  onRequest: () => void
}): ReactElement {
  const writes = useProviderWrites(engagementId)
  const [path, setPath] = useState('')
  const [args, setArgs] = useState('[]')
  const [error, setError] = useState<string | null>(null)
  const approved = access.key === 'approved'

  const dispatch = useMutation({
    mutationFn: () => {
      let argv: unknown
      try { argv = JSON.parse(args) }
      catch { throw new TypeError('Arguments must be a JSON array of strings.') }
      if (!Array.isArray(argv) || !argv.every((arg): arg is string => typeof arg === 'string')) throw new TypeError('Arguments must be a JSON array of strings.')
      return writes.dispatch({ sessionId: session.id, requestId: crypto.randomUUID(), path: path.trim(), args: argv })
    },
    onSuccess: () => { setError(null); setPath('') },
    onError: (err) => setError(messageOf(err, 'The command was refused by the server (grant, session state or input bounds).')),
  })

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Single-shot: each command is its own execution. The session keeps no working directory or environment between commands, and no interactive shell is offered.</p>
      {!approved && (
        <Banner tone="warn" title="Commands need an approved grant" action={<Button size="sm" variant="secondary" onClick={onRequest}>Request access</Button>}>
          Your access: {access.label}. The server refuses a command without a live grant.
        </Banner>
      )}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); dispatch.mutate() }}>
        <Input aria-label="Command path" placeholder="Command path, for example whoami" value={path} onChange={(e) => setPath(e.target.value)} disabled={!approved} />
        <Textarea aria-label="Arguments as a JSON array of strings" value={args} onChange={(e) => setArgs(e.target.value)} disabled={!approved} />
        <Button type="submit" variant="primary" disabled={!approved || dispatch.isPending || path.trim() === ''}>
          {dispatch.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
          Run command
        </Button>
      </form>
      {error !== null && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div>
        <div className="mb-2 text-xs font-medium text-muted">Latest commands on this session</div>
        {recent.length === 0 ? <p className="text-sm text-muted">No command has run on this session yet.</p> : <CommandTable commands={recent} />}
      </div>
    </div>
  )
}

function ActivityTab({ commands, error }: { commands: C2ProviderCommand[]; error: string | null }): ReactElement {
  if (error !== null) return <p role="alert" className="text-sm text-bad">{error}</p>
  if (commands.length === 0) return <p className="text-sm text-muted">No commands recorded for this session.</p>
  return <CommandTable commands={commands} />
}

function AccessTab({ engagementId, session, access, grants, bounds, grantsError }: {
  engagementId: string
  session: C2ProviderSession
  access: MyAccess
  grants: C2ProviderGrant[]
  bounds: { minHours: number; maxHours: number } | null
  grantsError: string | null
}): ReactElement {
  const writes = useProviderWrites(engagementId)
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState('4')
  const [error, setError] = useState<string | null>(null)
  const min = bounds?.minHours ?? 1
  const max = bounds?.maxHours ?? 24

  const request = useMutation({
    mutationFn: () => writes.requestGrant({
      sessionId: session.id,
      reason: reason.trim(),
      expiresAt: new Date(Date.now() + Math.min(max, Math.max(min, Number(hours) || min)) * 3_600_000).toISOString(),
    }),
    onSuccess: () => { setReason(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The grant request was refused.')),
  })
  const decide = useMutation({
    mutationFn: (input: { grantId: string; decision: 'approved' | 'rejected' | 'revoked' }) => writes.decideGrant(input.grantId, input.decision),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The decision was refused.')),
  })

  return (
    <div className="space-y-4">
      <DescList
        items={[
          { k: 'Connection', v: <Status kind="gate" value={connectionOf(session) === 'alive' ? 'passed' : 'failed'} size="sm" label={connectionOf(session) === 'alive' ? 'Connected' : 'Dead'} /> },
          { k: 'Your access', v: access.label },
          { k: 'Controller', v: 'Not reported by the provider; commands take no exclusive lease' },
          { k: 'Grant length', v: `Between ${min} and ${max} hours, set by the server` },
        ]}
      />

      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]" onSubmit={(e) => { e.preventDefault(); setError(null); request.mutate() }}>
        <Textarea aria-label="Reason for access" required placeholder="Why this session needs a command" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="space-y-2">
          <Input aria-label="Hours" type="number" min={min} max={max} value={hours} onChange={(e) => setHours(e.target.value)} />
          <Button type="submit" variant="primary" disabled={request.isPending || reason.trim() === ''}>Request access</Button>
        </div>
      </form>

      <div>
        <div className="mb-2 text-xs font-medium text-muted">Grants on this session</div>
        {grantsError !== null ? <p role="alert" className="text-sm text-bad">{grantsError}</p>
          : grants.length === 0 ? <p className="text-sm text-muted">No grant has been requested for this session.</p>
          : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-neutral">
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Requested by</th>
                  <th className="py-2 pr-3 font-medium">Reviewer</th>
                  <th className="py-2 pr-3 font-medium">Expires (UTC)</th>
                  <th className="py-2 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">{grant.status}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{grant.actorId}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{grant.reviewerId ?? '—'}</td>
                    <td className="py-2 pr-3">{utcMinute(grant.expiresAt)}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-2">
                        {grant.status === 'requested' && (
                          <>
                            <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ grantId: grant.id, decision: 'approved' })}>Approve</Button>
                            <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ grantId: grant.id, decision: 'rejected' })}>Reject</Button>
                          </>
                        )}
                        {grant.status === 'approved' && (
                          <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ grantId: grant.id, decision: 'revoked' })}>Revoke</Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      <p className="text-xs text-muted">The server decides who may approve, reject or revoke a grant; a refused decision shows its reason.</p>
      {error !== null && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  )
}
