import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, Clock, FileSearch, FolderKanban, Home, LifeBuoy, Loader2, Lock, LogIn, RefreshCw, ShieldOff, ServerCrash, UserCog, WifiOff, Inbox, Eye, Plug, Database, Filter } from 'lucide-react'
import { ROLE_LABEL, useStore } from '../store'
import { USERS } from '../data'
import { Banner, Button, Card, CardHeader, Empty, PageHeader, Skeleton, Status, STATUS, Table, Mono, type StatusKind } from '../ui'

/* ───────── Shared error page frame ───────── */
function ErrorFrame({ code, icon: I, tone, title, desc, reason, children, actions }: { code?: string; icon: typeof Lock; tone: string; title: string; desc: string; reason?: ReactNode; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-10 text-center sm:py-16">
      <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel ${tone}`}><I size={30} aria-hidden /></div>
      {code && <div className="mb-2 font-mono text-sm tracking-widest text-neutral">{code}</div>}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{desc}</p>
      {reason && <div className="mt-5 w-full rounded-xl border border-line bg-panel p-4 text-left text-sm">{reason}</div>}
      {children}
      <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      <p className="mt-8 flex items-center gap-1.5 text-xs text-muted"><LifeBuoy size={13} aria-hidden />Need help? Contact your organization admin or send the incident ID to operations.</p>
    </div>
  )
}

const REQUIRED: Record<string, string[]> = { default: ['manager', 'admin'] }

export function Forbidden() {
  const { go, me, setMe, setSwitcherOpen, toast, route } = useStore()
  const need = (REQUIRED[route.id || ''] || REQUIRED.default) as (keyof typeof ROLE_LABEL)[]
  const suggest = USERS.find((u) => need.includes(u.role))
  return (
    <ErrorFrame
      code="403" icon={ShieldOff} tone="text-bad" title="Access denied"
      desc="You are signed in, but your current role is not allowed to view or perform this action. Names and data of restricted content are not shown."
      reason={
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><dt className="mb-1 text-xs text-muted">Current role</dt><dd className="font-medium">{ROLE_LABEL[me.role]}</dd><dd className="text-xs text-muted">{me.name}</dd></div>
          <div><dt className="mb-1 text-xs text-muted">Required role</dt><dd className="font-medium">{need.map((r) => ROLE_LABEL[r]).join(' or ')}</dd><dd className="text-xs text-muted">Per the organization's access policy</dd></div>
        </dl>
      }
      actions={<>
        <Button variant="primary" icon={Home} onClick={() => go('command-center')}>Back to Command Center</Button>
        <Button icon={FolderKanban} onClick={() => setSwitcherOpen(true)}>Switch project</Button>
        {suggest && <Button icon={UserCog} onClick={() => { setMe(suggest.name); toast(`Switched to ${suggest.name} (${ROLE_LABEL[suggest.role]}) — demo only.`, 'info'); go('command-center') }}>Switch to {suggest.name}</Button>}
        <Button variant="ghost" onClick={() => toast('Access request sent to the organization admin (simulated).', 'info')}>Request access</Button>
      </>}
    />
  )
}

export function NotFound() {
  const { go, route } = useStore()
  return (
    <ErrorFrame
      code="404" icon={FileSearch} tone="text-warn" title="Page not found"
      desc="The link does not exist, was removed, or you do not have permission to view it. Check the link or go back to a list to find the right item."
      reason={<div className="flex items-center gap-2 text-xs text-muted"><span>Requested path:</span><Mono className="break-all text-fg">#/{route.page}{route.id ? '/' + route.id : ''}</Mono></div>}
      actions={<>
        <Button variant="primary" icon={Home} onClick={() => go('command-center')}>Back to Command Center</Button>
        <Button icon={ArrowLeft} onClick={() => window.history.back()}>Go back</Button>
        <Button icon={FolderKanban} onClick={() => go('projects')}>View projects</Button>
      </>}
    />
  )
}

export function ServerError() {
  const { go, toast } = useStore()
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  const retry = () => {
    setBusy(true)
    setTimeout(() => {
      setBusy(false); setTries(tries + 1)
      if (tries >= 1) { toast('Reloaded successfully.'); go('command-center') } else toast('The server is still not responding. Try again in a few seconds.', 'warn')
    }, 900)
  }
  return (
    <ErrorFrame
      code="500" icon={ServerCrash} tone="text-bad" title="Something went wrong"
      desc="The request could not be completed because of a server error. Data you already saved is not affected. Try again; if it keeps failing, send the incident ID below to operations."
      reason={<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>Incident ID</span><Mono className="text-fg">INC-20261013-0427</Mono></div>}
      actions={<>
        <Button variant="primary" icon={busy ? Loader2 : RefreshCw} disabled={busy} onClick={retry}>{busy ? 'Retrying…' : 'Retry'}</Button>
        <Button icon={Home} onClick={() => go('command-center')}>Back to Command Center</Button>
        <Button variant="ghost" onClick={() => { void navigator.clipboard?.writeText('INC-20261013-0427'); toast('Incident ID copied.', 'info') }}>Copy incident ID</Button>
      </>}
    />
  )
}

export function Offline() {
  const { go, toast } = useStore()
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState(0)
  const check = () => {
    setBusy(true)
    setTimeout(() => {
      setBusy(false); setN(n + 1)
      if (n >= 1) { toast('Reconnected. Data is in sync.'); go('command-center') } else toast('Still no connection to the workspace.', 'warn')
    }, 1000)
  }
  return (
    <ErrorFrame
      icon={WifiOff} tone="text-warn" title="Workspace temporarily unavailable"
      desc="The connection to the server was lost. Displayed data may be stale and write actions are locked to avoid inconsistencies. Running operations continue to be orchestrated by the execution system and are not stopped."
      reason={<ul className="space-y-1.5 text-xs text-muted"><li className="flex gap-2"><Clock size={13} className="mt-0.5 shrink-0" aria-hidden />Last successful sync: Oct 13, 2026, 10:42 AM (UTC+7)</li><li className="flex gap-2"><Lock size={13} className="mt-0.5 shrink-0" aria-hidden />Start, stop and approval actions are available only while connected.</li></ul>}
      actions={<>
        <Button variant="primary" icon={busy ? Loader2 : RefreshCw} disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check connection again'}</Button>
        <Button icon={Home} onClick={() => go('command-center')}>Back to Command Center (saved data)</Button>
      </>}
    />
  )
}

export function SessionExpired() {
  const { logout, me } = useStore()
  return (
    <ErrorFrame
      icon={Clock} tone="text-warn" title="Your session has expired"
      desc="For safety, sessions end automatically after a period of inactivity. Sign in again to continue; your saved drafts are kept."
      reason={<div className="text-xs text-muted">Account: <span className="text-fg">{me.email}</span> · Unsaved changes in open forms may be lost.</div>}
      actions={<Button variant="primary" icon={LogIn} onClick={logout}>Sign in again</Button>}
    />
  )
}

/* ───────── SYS-07: state gallery ───────── */
const KIND_LABEL: Record<StatusKind, string> = {
  project: 'Project', op: 'Operation', step: 'Execution step', agent: 'Agent', finding: 'Finding', report: 'Report', scope: 'Asset scope', approval: 'Approval',
  roe: 'ROE', sev: 'Severity', check: 'Preflight', detect: 'Detection (SIEM)', integ: 'Integration', generic: 'Generic',
  plan: 'AI plan', session: 'C2 session', perm: 'Session permission', c2: 'C2 node', channel: 'C2 channel', tool: 'AI tool call', access: 'Session access request', gate: 'Gate',
}

function Sample({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2"><h2 className="text-sm font-semibold">{title}</h2><p className="text-xs text-muted">{desc}</p></div>
      {children}
    </section>
  )
}

export function StatesGallery() {
  const { go, toast, setSwitcherOpen } = useStore()
  const [loading, setLoading] = useState(false)
  const reload = () => { setLoading(true); setTimeout(() => setLoading(false), 1200) }
  const rows = [{ id: 'RT-2026-014', n: 'Internal Red Team Q4', s: 'active' }, { id: 'RT-2026-015', n: 'Cloud Security Assessment', s: 'active' }, { id: 'PT-2026-006', n: 'Purple Team Exercise Q4', s: 'pending' }]
  return (
    <div>
      <PageHeader title="Universal state set" sub="Every screen with a table or chart must handle all the variants below. Status never relies on color alone: it always has an icon and a label." actions={<Button icon={RefreshCw} onClick={reload}>Simulate reload</Button>} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Sample title="1. Loading" desc="Skeleton matches the table/card shape; no stale numbers are shown when switching projects.">
          <Card>
            {loading ? (
              <div aria-busy="true" aria-label="Loading data" className="space-y-2.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <Table dense rowKey={(r) => r.id} rows={rows} cols={[{ key: 'id', header: 'ID', render: (r) => <Mono>{r.id}</Mono> }, { key: 'n', header: 'Project name', render: (r) => r.n }, { key: 's', header: 'Status', render: (r) => <Status kind="project" value={r.s} /> }]} />
            )}
            {!loading && <p className="mt-3 text-xs text-muted">Press “Simulate reload” to see the skeleton for 1.2 seconds.</p>}
          </Card>
        </Sample>

        <Sample title="2. Empty (natural / filtered)" desc="Explains why and offers a call to action if the user has permission; filtered-empty lets users clear filters.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Empty icon={Inbox} title="No operations yet" action={<Button size="sm" variant="primary" onClick={() => go('operation-new')}>Create operation</Button>}>This project has no operations. Create the first one once the ROE is approved.</Empty>
            <Empty icon={Filter} title="No matching results" action={<Button size="sm" onClick={() => toast('Filters cleared.', 'info')}>Clear filters</Button>}>Remove some filters or change the search keyword.</Empty>
          </div>
        </Sample>

        <Sample title="3. Network error / failed to load" desc="States the problem and the fix; includes Retry.">
          <Banner tone="bad" title="Could not load the findings list" action={<Button size="sm" icon={RefreshCw} onClick={() => toast('Retrying…', 'info')}>Retry</Button>}>Lost connection to the server (code NET-504). Displayed data may be incomplete.</Banner>
        </Sample>

        <Sample title="4. Insufficient permission" desc="No-permission frame with a way out; restricted objects are not revealed.">
          <Card className="flex flex-wrap items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-bad/12 text-bad"><ShieldOff size={22} aria-hidden /></div>
            <div className="min-w-0 flex-1"><div className="font-semibold">You do not have permission to view this item</div><div className="text-sm text-muted">Requires the Red Team Manager or Organization Admin role.</div></div>
            <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => go('command-center')}>Back to Command Center</Button><Button size="sm" onClick={() => setSwitcherOpen(true)}>Switch project</Button></div>
          </Card>
        </Sample>

        <Sample title="5. Read-only" desc="Banner states the reason; edit or run buttons are hidden (or locked with a reason).">
          <Banner tone="warn" icon={Eye} title="Project closed — read-only">Project RT-2026-009 closed on Aug 30, 2026, 5:00 PM (UTC+7). An Organization Admin can reopen it and must enter a reason.</Banner>
          <div className="flex flex-wrap items-center gap-3"><Button disabled title="Project closed — read-only">Create operation</Button><span className="inline-flex items-center gap-1.5 text-xs text-muted"><Lock size={13} aria-hidden />Project closed — read-only.</span></div>
        </Sample>

        <Sample title="6. Stale data" desc="Shows the last update time, a warning and a refresh action.">
          <Banner tone="warn" icon={Clock} title="Live data is stale" action={<Button size="sm" icon={RefreshCw} onClick={() => toast('Data refreshed.')}>Refresh</Button>}>Last updated Oct 13, 2026, 10:37 AM (UTC+7) — real-time signal from OP-014 was lost. Do not use these figures for stop/continue decisions.</Banner>
        </Sample>

        <Sample title="7. Partial data" desc="States what is missing and why; never fills in fake 0% or 100% values.">
          <Card>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[['Detection (SIEM)', 'No data yet'], ['Steps run', '7/12'], ['Evidence', '2 files']].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line p-3"><div className="text-xs text-muted">{k}</div><div className={v === 'No data yet' ? 'mt-1 text-sm text-neutral' : 'mt-1 text-xl font-semibold tabular-nums'}>{v}</div></div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />Detection coverage counts only the 3 of 8 techniques that have data from SIEM-Lab (demo).</p>
          </Card>
        </Sample>

        <Sample title="8. No data from integration" desc="Names the missing data source; links to Integrations if permitted.">
          <Empty icon={Plug} title="No data from the detection source" action={<Button size="sm" icon={Database} onClick={() => go('settings', { tab: 'integrations' })}>View integrations</Button>}>The SIEM integration is not connected or has not synced for this project.</Empty>
        </Sample>
      </div>

      <Card className="mt-6">
        <CardHeader title="9. Status legend" sub="All statuses used in the app, grouped by object." />
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {(Object.keys(STATUS) as StatusKind[]).map((k) => (
            <div key={k}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{KIND_LABEL[k]}</div>
              <div className="flex flex-wrap gap-2">{Object.keys(STATUS[k]).map((v) => <Status key={v} kind={k} value={v} />)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
