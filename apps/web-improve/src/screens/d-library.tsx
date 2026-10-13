import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, Eye, ClipboardCheck, Copy, Crosshair, ExternalLink, GitCompare, Layers, Play, Plus, Send, Sparkles, Upload, X } from 'lucide-react'
import { useStore } from '../store'
import { TACTICS, TECHNIQUES, type Playbook } from '../data'
import { Banner, Button, Card, CardHeader, DescList, Empty, Field, FilterBar, IdLink, Input, Kpi, Locked, Mono, PageHeader, Pager, SearchBox, Select, Skeleton, Status, Table, Tabs, Textarea, Timeline, useGuard, cx } from '../ui'
import { Id, IdL, MoreFilters, withLoading } from './d-shared'
import { LibraryReadError, usePlaybookDetail, usePlaybookList, usePlaybookReview, usePlaybookReviewQueue, useTechniqueDetail } from '../features/library/query'

const tName = (id: string) => TECHNIQUES.find((t) => t.id === id)?.name ?? id

function PbStatus({ s }: { s: Playbook['status'] }) {
  return s === 'approved' ? <Status kind="check" value="pass" label="Approved" /> : s === 'review' ? <Status kind="report" value="review" label="In review" /> : <Status kind="report" value="draft" label="Draft, not usable yet" />
}

/* ───────────── Playbooks & TTPs (PB-01, ticket 52: typed service read + Query) ───────────── */
function Playbooks() {
  const { route, go, pid, persistFilters, setFilter, can, toast } = useStore()
  const tab = route.tab || 'playbooks'
  const [q, setQ] = useState(''), [tac, setTac] = useState(''), [os, setOs] = useState(''), [st, setSt] = useState('')
  const [page, setPage] = useState(1)
  const kind = tab === 'profiles' ? 'profile' : 'playbook'
  /* The one library read: scope-checked typed service; cards, tab badges,
     technique catalog rows and the detection overlay all derive from the
     actor-visible active versions (pending revisions stay projections). */
  const list = usePlaybookList({ kind, q: q || undefined, tactic: tac || undefined, os: os || undefined, status: st || undefined, page: page > 1 ? page : undefined })
  useEffect(() => { setPage(1) }, [q, tac, os, st, tab])
  const read = list.data
  const pre: string[] | undefined = persistFilters['operation-new.assets']
  const filtered = !!(q || tac || os || st)
  const clear = () => { setQ(''); setTac(''); setOs(''); setSt('') }
  const createWhy = !can('editScope') ? 'Only editors (Red Team Managers and Admins) can create playbooks.' : ''
  const importWhy = !can('admin') ? 'Importing playbooks is restricted by policy to Admins. Ask an Admin to import it, or create a draft instead.' : ''
  return (
    <>
      <PageHeader title="Playbooks & TTPs" sub="Playbooks, simulated adversary profiles and the MITRE ATT&CK catalog. Only approved playbooks can be used in new operations."
        actions={<>
          <Button icon={Upload} disabled={!!importWhy} title={importWhy || 'Import a playbook'} onClick={() => toast('Import is simulated in this prototype. Use Create Playbook to start a draft.', 'info')}>Import</Button>
          <Button variant="primary" icon={Plus} disabled={!!createWhy} title={createWhy || 'Create a draft playbook'} onClick={() => toast('Draft editor is not part of this prototype. Duplicate an existing playbook as a draft instead.', 'info')}>Create Playbook</Button>
        </>} />
      {(createWhy || importWhy) && <div className="-mt-2 mb-3 flex flex-col gap-1">{createWhy && <Locked reason={`Create Playbook: ${createWhy}`} />}{importWhy && <Locked reason={`Import: ${importWhy}`} />}</div>}
      {pre && pre.length > 0 && (
        <Banner tone="info" title={`${pre.length} in-scope ${pre.length === 1 ? 'asset is' : 'assets are'} selected as targets`} action={<Button size="sm" variant="ghost" onClick={() => setFilter('operation-new.assets', [])}>Clear selection</Button>}>Open an approved playbook and choose “Use in operation” to continue creating the operation.</Banner>
      )}
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading library"><Skeleton className="h-96" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Library could not be loaded" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as LibraryReadError).failure.message}
        </Empty>
      ) : read && (
        <>
          <Tabs value={tab} onChange={(t) => { clear(); go('playbooks', { tab: t }) }} tabs={[{ id: 'playbooks', label: 'Playbooks', count: read.counts.playbooks }, { id: 'profiles', label: 'Adversary profiles', count: read.counts.profiles }, { id: 'techniques', label: 'MITRE ATT&CK techniques', count: read.counts.techniques }]} />
          <FilterBar>
            <SearchBox className="w-64" value={q} onChange={setQ} placeholder={tab === 'techniques' ? 'Search technique ID or name' : 'Search name, ID or goal'} />
            <Select className="!w-52" aria-label="Tactic" value={tac} onChange={(e) => setTac(e.target.value)}><option value="">All tactics</option>{TACTICS.map((t) => <option key={t}>{t}</option>)}</Select>
            {tab !== 'techniques' && <Select className="!w-44" aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option><option value="approved">Approved</option><option value="review">In review</option><option value="draft">Draft</option></Select>}
            <MoreFilters active={os ? 1 : 0}><Select aria-label="OS" value={os} onChange={(e) => setOs(e.target.value)}><option value="">All OS</option><option>Windows</option><option>Linux</option></Select></MoreFilters>
            {filtered && <Button variant="ghost" size="sm" icon={X} onClick={clear}>Clear filters</Button>}
          </FilterBar>
          {tab !== 'techniques' ? (
            !read.items.length ? <Empty icon={BookOpen} title={filtered ? 'No items match the filters' : tab === 'profiles' ? 'No adversary profiles yet' : 'No playbooks yet'} action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined}>Try relaxing the filters or switching tabs.</Empty> : (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {read.items.map(({ playbook: p, pendingRevision }) => (
                    <button key={p.id} onClick={() => go('playbook', { id: p.id })} className={cx('flex flex-col rounded-xl border bg-panel p-5 text-left transition hover:bg-hover', p.status === 'draft' ? 'border-warn/40' : 'border-line')}>
                      <div className="mb-2 flex items-start justify-between gap-2"><Id className="text-muted">{p.id} · v{p.version}</Id><PbStatus s={p.status} /></div>
                      <div className="text-[15px] font-semibold">{p.name}</div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{p.desc}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">{p.techniques.slice(0, 5).map((t) => <span key={t} className="rounded-md border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-cyan">{t}</span>)}{p.techniques.length > 5 && <span className="text-[11px] text-muted">+{p.techniques.length - 5}</span>}</div>
                      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-muted"><span>{p.steps.length} steps</span><span>{p.os.join(' / ')}</span><span>{p.owner}</span><span className="ml-auto">Updated {p.updated}</span></div>
                      {p.status === 'draft' && <div className="mt-2 flex items-center gap-1.5 text-xs text-warn"><AlertTriangle size={13} />Draft: Preview Draft only, not usable in operations</div>}
                      {pendingRevision && <div className="mt-2 flex items-center gap-1.5 text-xs text-accent"><ClipboardCheck size={13} />v{pendingRevision.version} pending review · v{p.version} stays approved</div>}
                    </button>
                  ))}
                </div>
                <Pager page={read.page} pages={Math.max(1, Math.ceil(read.total / read.pageSize))} setPage={setPage} total={read.total} />
              </>
            )
          ) : (
            <>
              {pid !== 'all' && !read.detection && <p className="mb-3 text-xs text-muted">The selected project has no SIEM detection data yet.</p>}
              {!read.techniques.length ? <Empty icon={Crosshair} title="No techniques match" action={<Button onClick={clear}>Clear filters</Button>} /> : (
                <div className="space-y-5">
                  {TACTICS.filter((t) => read.techniques.some((x) => x.tactic === t)).map((t) => (
                    <section key={t} aria-label={t}>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{t}<span className="rounded-full bg-hover px-1.5 text-[11px] font-normal text-muted">{read.techniques.filter((x) => x.tactic === t).length}</span></h3>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {read.techniques.filter((x) => x.tactic === t).map((x) => (
                          <button key={x.id} onClick={() => go('technique', { id: x.id })} className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 text-left transition hover:bg-hover">
                            <Mono className="text-cyan">{x.id}</Mono>
                            <span className="min-w-0 flex-1 text-sm"><span className="block truncate">{x.name}</span><span className="text-[11px] text-muted">{x.usedBy} {x.usedBy === 1 ? 'playbook' : 'playbooks'} · {x.platforms.join(', ')}</span></span>
                            {pid !== 'all' && <Status kind="detect" value={read.detection?.[x.id] || 'nodata'} size="sm" />}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

/* ───────────── Playbook detail (PB-02, PB-03) ───────────── */
function PlaybookDetail() {
  const { route, go, pid, project, can, A, toast, setFilter, setSwitcherOpen, confirm } = useStore()
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const read = usePlaybookDetail(route.id)
  const [asked, setAsked] = useState(false)
  const [attached, setAttached] = useState(false)
  const back = { label: 'Playbooks & TTPs', to: () => go('playbooks', { tab: read.data?.playbook.kind === 'profile' ? 'profiles' : 'playbooks' }) }
  if (read.isPending) return <div aria-busy="true" aria-label="Loading playbook"><Skeleton className="h-96" /></div>
  if (read.isError || !read.data) return <><PageHeader title="Playbook not found" back={{ label: 'Playbooks & TTPs', to: () => go('playbooks') }} /><Empty icon={BookOpen} title={`No playbook “${route.id}”`} action={<Button onClick={() => go('playbooks')}>Back to playbooks</Button>} /></>
  const { playbook: p, pending, pendingRevision, usage, usedProjects, tactics: tacs, versions, compat } = read.data
  const useWhy = p.status !== 'approved' ? 'This playbook is not approved yet. Request approval or ask a reviewer to approve it.' : pid === 'all' ? 'Select a specific project in the top bar to create an operation.' : guard.ro ? guard.reason : !can('run') ? 'Your role cannot create test operations.' : !['approved', 'active'].includes(project?.status || '') ? 'The project is not approved yet, so operations cannot be created.' : ''
  const pendingRev = pending
  const startNew = () => { setFilter('operation-new.playbook', p.id); go('operation-new') }
  const requestApproval = () => { A.audit('Playbook approval requested', p.id, '', 'Pending'); A.notify(`Playbook ${p.id} v${p.version} submitted for review`, '', { name: 'playbook', id: p.id }, 'todo'); setAsked(true); toast('Playbook review requested.', 'info') }
  const editWhy = !can('editScope') ? 'Only Red Team Managers and Admins can change playbooks.' : ''
  const approvalWhy = p.status === 'approved' ? 'Already approved.' : asked ? 'Request already sent.' : editWhy
  const attachWhy = p.status !== 'approved' ? 'Only approved playbooks can be added to a project.' : pid === 'all' ? 'Select a specific project to add this playbook.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can add playbooks to a project.' : ''
  const winOnly = compat?.winOnly ?? false
  const dup = () => confirm({
    title: `Duplicate ${p.id} as a draft?`, confirmLabel: 'Create draft copy', body: 'A draft copy is created for editing. It must be reviewed and approved before it can be used.',
    onConfirm: () => { A.audit('Playbook duplicated as draft', p.id, '', 'Success'); toast(`Draft copy of ${p.id} created (simulated).`, 'info') },
  })
  const attach = () => confirm({
    title: `Add ${p.id} v${p.version} to ${pid}?`, confirmLabel: 'Add to project', reasonLabel: 'Note (optional)',
    body: <>The playbook version is locked for this project. Later versions will not apply until a manager updates the project.</>,
    onConfirm: () => { setAttached(true); A.audit('Playbook added to project', p.id, pid, 'Success'); toast(`${p.id} added to ${pid}.`) },
  })
  return (
    <>
      <PageHeader back={back} title={p.name} meta={<><PbStatus s={p.status} /><Mono className="text-muted">{p.id} · v{p.version}</Mono></>} sub={p.desc}
        actions={<>
          {pendingRev && <Button icon={ClipboardCheck} disabled={!can('approve')} title={!can('approve') ? 'Only Reviewers and Admins can review playbooks.' : `Review pending ${pendingRevision ? 'v' + pendingRevision.version : 'revision'}`} onClick={() => go('playbook-review', { id: p.id })}>Review Playbook{pendingRevision ? ` v${pendingRevision.version}` : ''}</Button>}
          <Button icon={Plus} disabled={!!attachWhy || attached} title={attached ? 'Already added to this project.' : attachWhy || 'Add to project'} onClick={attach}>{attached ? 'Added to Project' : 'Add to Project'}</Button>
          <Button icon={Send} disabled={!!approvalWhy} title={approvalWhy || 'Request approval'} onClick={requestApproval}>{asked ? 'Approval Requested' : 'Request Approval'}</Button>
          <Button icon={GitCompare} disabled={!pendingRev} title={!pendingRev ? 'No pending revision to compare. v' + p.version + ' is the only version under review policy.' : 'Compare the pending revision with the approved version'} onClick={() => go('playbook-review', { id: p.id })}>Compare Versions</Button>
          <Button icon={Copy} disabled={!!editWhy} title={editWhy || 'Duplicate as a draft'} onClick={dup}>Duplicate Draft</Button>
          <Button icon={Sparkles} disabled={p.status !== 'approved'} title={p.status !== 'approved' ? 'Only approved playbooks can be used for planning.' : 'Open AI Operator'} onClick={() => go('ai-operator')}>Ask AI Operator to plan with this playbook</Button>
          {p.status === 'draft'
            ? <Button variant="primary" icon={Eye} title="Read-only preview. Drafts cannot be used in operations." onClick={() => toast('Draft preview is read-only: nothing is created or executed.', 'info')}>Preview Draft</Button>
            : <Button variant="primary" icon={Play} disabled={!!useWhy} title={useWhy || 'Create a new operation with this playbook'} onClick={startNew}>Use in operation</Button>}
        </>} />
      {p.status === 'draft' && <Banner tone="warn" title="Draft: cannot be used yet">This playbook has not been approved, so it cannot be chosen for new operations and does not pass preflight. Request approval first.</Banner>}
      {pendingRevision && <Banner tone="info" title={`v${pendingRevision.version} is pending review`} action={can('approve') ? <Button size="sm" onClick={() => go('playbook-review', { id: p.id })}>Review Playbook</Button> : undefined}>v{p.version} is the approved version and stays in use; it is read-only. Revision v{pendingRevision.version} by {pendingRevision.by} is not usable until a reviewer approves it.</Banner>}
      {p.status === 'review' && <Banner tone="info" title="Awaiting review" action={can('approve') ? <Button size="sm" onClick={() => go('playbook-review', { id: p.id })}>Open review</Button> : undefined}>This playbook cannot be used until a reviewer approves it.</Banner>}
      {(useWhy || approvalWhy || editWhy) && <div className="-mt-2 mb-4 flex flex-col gap-1">{useWhy && <Locked reason={`Use in operation: ${useWhy}`} />}{p.status !== 'approved' && approvalWhy && !asked && <Locked reason={`Request Approval: ${approvalWhy}`} />}{editWhy && <Locked reason={`Duplicate Draft: ${editWhy}`} />}{pid === 'all' && p.status === 'approved' && <Button size="sm" onClick={() => setSwitcherOpen(true)}>Select project</Button>}</div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><CardHeader title="Overview" />
            <DescList cols={2} items={[{ k: 'Goal', v: p.goal }, { k: 'Owner', v: p.owner }, { k: 'Sharing', v: p.share }, { k: 'Last updated', v: p.updated }, { k: 'Compatible OS', v: p.os.join(' / ') }, { k: 'Agent requirement', v: `${p.os.join(' or ')} agent, connected, assigned to the operation's project` }, { k: 'Related tactics', v: tacs.join(', ') }, { k: 'Environment', v: 'Lab environments within the approved ROE scope only' }]} />
          </Card>
          <Card><CardHeader title={`Steps (${p.steps.length})`} sub="Step names and high-level descriptions only. No command content." />
            <ol className="divide-y divide-line rounded-lg border border-line">
              {p.steps.map((s, i) => (
                <li key={i} className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">{s}</span>
                  {p.techniques[i] && <button onClick={() => go('technique', { id: p.techniques[i] })} className="rounded-md border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-cyan hover:bg-hover" title={tName(p.techniques[i])}>{p.techniques[i]}</button>}
                </li>
              ))}
            </ol>
          </Card>
          <Card><CardHeader title="Related ATT&CK techniques" />
            <div className="flex flex-wrap gap-2">{p.techniques.map((t) => <button key={t} onClick={() => go('technique', { id: t })} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-xs hover:bg-hover"><Mono className="text-cyan">{t}</Mono><span className="text-muted">{tName(t)}</span></button>)}</div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card><CardHeader title="Attach to project" sub={pid === 'all' || !compat ? 'Select a project to check compatibility.' : `Compatibility with ${compat.projectId}`} />
            {!compat ? <p className="text-sm text-muted">Compatibility checks need a specific project. Select one in the top bar.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                <li className="flex items-start gap-2 px-3 py-2"><Status kind="check" value={compat.matching ? 'pass' : 'fail'} size="sm" /><span>Scope compatibility: {compat.matching} of {compat.inScope} in-scope assets run {p.os.join(' / ')}.{!compat.matching && ' No in-scope assets match, so request a scope change or choose another playbook.'}</span></li>
                <li className="flex items-start gap-2 px-3 py-2"><Status kind="check" value={p.status === 'approved' ? 'pass' : 'fail'} size="sm" /><span>Version lock: v{p.version} is locked once added to the project.{p.status !== 'approved' && ' Requires an approved version.'}</span></li>
                <li className="flex items-start gap-2 px-3 py-2"><Status kind="check" value={winOnly ? 'fail' : 'pass'} size="sm" /><span>Blocked variants: {winOnly ? `Variants for other operating systems are blocked (${p.os[0]} only).` : 'No variants are blocked for this project.'}</span></li>
              </ul>
            )}
            {attachWhy && !attached && <div className="mt-2"><Locked reason={attachWhy} /></div>}
            {attached && <p className="mt-2 text-xs text-ok">Added to {pid}. Version v{p.version} is locked.</p>}
          </Card>
          <Card><CardHeader title="Warnings & restrictions" />
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />Runs only on assets in approved scope.</li>
              <li className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />Follows the project ROE time windows and restrictions.</li>
              <li className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />Emergency stop is available at any time.</li>
            </ul>
          </Card>
          <Card><CardHeader title="Version history" /><Timeline items={versions} /></Card>
          <Card><CardHeader title="Usage / Impact" sub="Which version is pinned where" />
            {usage.plans.length + usage.operations.length ? <ul className="space-y-2 text-sm">
              {usage.plans.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2"><IdL onClick={() => go('ai-plan', { id: x.id })}>{x.id}</IdL><span className="text-xs text-muted">{x.label} · {x.status} · pins v{p.version}</span></li>)}
              {usage.operations.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2"><IdL onClick={() => go('operation', { id: o.id })}>{o.id}</IdL><span className="text-xs text-muted">{o.status} · pins v{p.version}</span></li>)}
            </ul> : <p className="text-sm text-muted">No AI plan or operation pins this playbook yet.</p>}
            <p className="mt-3 text-xs text-muted">Editing or approving a new playbook version never changes a plan or operation that is already running. They keep their pinned version until a manager re-plans.</p>
          </Card>
          <Card><CardHeader title="Projects that used it" sub="Only projects you can access are shown." />
            {usedProjects.length ? <ul className="space-y-2 text-sm">{usedProjects.map((u) => <li key={u.id} className="flex items-center justify-between gap-2"><IdLink onClick={() => go('project', { id: u.id })}>{u.id}</IdLink><span className="text-xs text-muted">{u.operations.join(', ')}</span></li>)}</ul> : <p className="text-sm text-muted">No project has used this playbook yet.</p>}
          </Card>
        </div>
      </div>
    </>
  )
}

/* ───────────── Playbook review (PB-V3-03 / V3-14, ticket 53: typed service) ───────────── */
function PlaybookReview() {
  const { route, go, can, me, confirm, toast } = useStore()
  const detail = usePlaybookDetail(route.id)
  const queue = usePlaybookReviewQueue()
  const review = usePlaybookReview()
  const [ver, setVer] = useState('')
  const [log, setLog] = useState('')
  const back = { label: 'Playbooks & TTPs', to: () => go('playbooks') }
  /* Deep link without an id: the review queue. */
  if (!route.id) {
    const items = queue.data?.items ?? []
    return (
      <>
        <PageHeader title="Playbook review queue" sub="Pending revisions and initial versions awaiting a decision. The active version stays approved and in use until a reviewer decides." />
        {queue.isPending ? <div aria-busy="true" aria-label="Loading review queue"><Skeleton className="h-64" /></div>
          : queue.isError ? <Empty icon={AlertTriangle} title="Review queue could not be loaded" action={<Button onClick={() => queue.refetch()}>Retry</Button>}>{(queue.error as LibraryReadError).failure.message}</Empty>
            : !items.length ? <Empty icon={ClipboardCheck} title="Nothing is waiting for review">Submitted revisions appear here until a reviewer approves or returns them.</Empty> : (
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.playbookId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{it.name} <Id className="text-muted">{it.playbookId} · v{it.pending.version} → v{it.activeVersion}</Id></div>
                      <p className="mt-0.5 text-xs text-muted">{it.pending.kind === 'revision' ? 'Revision' : 'Initial version'} by {it.pending.by} · {it.pending.at}</p>
                    </div>
                    <Button size="sm" disabled={!it.canDecide} title={it.decideReason || `Review ${it.playbookId}`} onClick={() => go('playbook-review', { id: it.playbookId })}>Review</Button>
                  </li>
                ))}
              </ul>
            )}
      </>
    )
  }
  if (detail.isPending) return <div aria-busy="true" aria-label="Loading review"><Skeleton className="h-96" /></div>
  if (detail.isError || !detail.data) return <><PageHeader title="Playbook not found" back={back} /><Empty icon={BookOpen} title={`No playbook “${route.id}”`} action={<Button onClick={() => go('playbooks')}>Back to playbooks</Button>} /></>
  const { playbook: p, pendingRevision: rev, usage } = detail.data
  const legacyReview = p.status === 'review'
  const newVer = rev?.version || p.version
  const author = rev?.by || p.owner
  const usedOps = usage.operations.filter((o) => !['done', 'cancelled'].includes(o.status)).map((o) => o.id)
  /* The decide gate mirrors the handler: role policy first, then author independence. */
  const why = !can('approve') ? 'Only Reviewers and Admins can approve or return playbooks.' : author === me.name ? 'You cannot review your own revision. Ask another reviewer.' : ''
  const decide = (decision: 'approve' | 'return') => confirm({
    title: decision === 'approve' ? `Approve ${p.id} v${newVer}?` : `Return ${p.id} v${newVer} to draft?`,
    danger: decision === 'return',
    confirmLabel: decision === 'approve' ? 'Approve revision' : 'Return to Draft',
    reasonLabel: decision === 'approve' ? 'Approval reason' : 'Reason for returning',
    reasonRequired: true,
    body: decision === 'approve'
      ? <>v{newVer} becomes the approved version. v{p.version} is frozen as archived. {usedOps.length ? `${usedOps.join(', ')} stay pinned to v${p.version}; they do not change automatically.` : ''}</>
      : <>The pending revision goes back to its author{rev ? ` (${rev.by})` : ''} with your reason. The approved v{p.version} is unaffected.</>,
    onConfirm: (r) => {
      review.decideRevision(p.id, decision, r).then((res) => {
        if (!res.ok) { toast(res.failure.message, 'bad'); return }
        toast(decision === 'approve' ? `${p.id} v${newVer} approved.` : `v${newVer} returned to draft.`, decision === 'approve' ? undefined : 'warn')
        go('playbook', { id: p.id })
      })
    },
  })
  /* Nothing pending: reviewers get the empty state; editors propose the next
     revision (version bump + changelog) or submit a draft for review — the
     approved version is preserved until an independent approval. */
  if (!rev && !legacyReview) {
    const editWhy = !can('editScope') ? 'Only Red Team Managers and Admins can propose revisions.' : ''
    const propose = () => {
      review.proposeRevision(p.id, { version: ver, summary: log.split('\n') }).then((res) => {
        if (!res.ok) { toast(res.failure.message, 'bad'); return }
        toast(`Revision v${res.data.revision?.version} submitted — v${p.version} stays approved and in use.`, 'info')
        setVer(''); setLog('')
      })
    }
    const submitInitial = () => {
      review.submitForReview(p.id).then((res) => {
        if (!res.ok) { toast(res.failure.message, 'bad'); return }
        toast(`${p.id} v${p.version} submitted for review.`, 'info')
      })
    }
    return (
      <>
        <PageHeader back={back} title={p.name} meta={<><PbStatus s={p.status} /><Id className="text-muted">{p.id} · v{p.version}</Id></>} sub="Nothing to review" />
        <Empty icon={ClipboardCheck} title={p.status === 'approved' ? `v${p.version} is approved: no pending revision` : 'This draft has not been submitted for review'} action={<Button onClick={() => go('playbook', { id: p.id })}>Open playbook (read-only)</Button>}>
          {p.status === 'approved' ? 'The approved version is read-only and cannot be approved again. A review opens only when a new revision is submitted.' : 'Ask the owner to request approval first. Until then it can only be previewed.'}
        </Empty>
        {p.status === 'approved' && !editWhy && (
          <Card className="mt-4"><CardHeader title={`Propose revision after v${p.version}`} sub="The approved version stays active until a reviewer approves the revision." />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="New version" required hint={`Strict bump above v${p.version}, e.g. v${p.version.split('.')[0]}.${Number(p.version.split('.')[1]) + 1}`}><Input value={ver} onChange={(e) => setVer(e.target.value)} placeholder={`${p.version.split('.')[0]}.${Number(p.version.split('.')[1]) + 1}`} /></Field>
              <Field label="Changelog" required hint="One entry per line. Recorded with the revision."><Textarea value={log} onChange={(e) => setLog(e.target.value)} placeholder={'Added step: validate audit-log forwarding (safe)'} /></Field>
            </div>
            <div className="mt-3"><Button variant="primary" icon={Send} disabled={!ver.trim() || !log.trim()} title={!ver.trim() || !log.trim() ? 'A version and a changelog entry are required.' : 'Submit the revision for review'} onClick={propose}>Submit revision</Button></div>
          </Card>
        )}
        {p.status === 'draft' && !editWhy && (
          <Card className="mt-4"><CardHeader title="Submit for review" sub="A draft cannot be used in operations until a reviewer approves it." />
            <Button variant="primary" icon={Send} onClick={submitInitial}>Submit v{p.version} for review</Button>
          </Card>
        )}
        {editWhy && <div className="mt-4"><Locked reason={editWhy} /></div>}
      </>
    )
  }
  const oldSteps = p.steps
  const oldTech = p.techniques
  const newSteps = rev?.steps || p.steps
  const newTech = rev?.techniques || p.techniques
  const added = newSteps.filter((s) => !oldSteps.includes(s))
  const removed = oldSteps.filter((s) => !newSteps.includes(s))
  const addedT = [...new Set(newTech.filter((t) => !oldTech.includes(t)))]
  const removedT = [...new Set(oldTech.filter((t) => !newTech.includes(t)))]
  const changed = rev?.summary.filter((x) => !/^added step/i.test(x)) ?? []
  const risk = [...(addedT.length ? [`New techniques: ${addedT.map((t) => `${t} ${tName(t)}`).join(', ')}.`] : []), ...(rev?.summary.filter((x) => /approval|manual/i.test(x)) || []), 'All steps remain lab-only simulated actions; no command content is included.']
  const timeline = rev
    ? [
      { at: rev.at, title: `v${rev.version}: pending review`, sub: rev.by, tone: 'warn' as const },
      { at: p.updated, title: `v${p.version}: approved (frozen)`, sub: p.owner, tone: 'ok' as const },
    ]
    : [{ at: p.updated, title: `v${p.version}: pending review (initial version)`, sub: p.owner, tone: 'warn' as const }]
  return (
    <>
      <PageHeader back={back} title={`Review ${p.name}`} meta={<><Status kind="report" value="review" label="Pending review" /><Id className="text-muted">{p.id} v{newVer} vs v{p.version}</Id></>} sub={rev ? `Revision v${newVer} by ${author} is compared with the approved v${p.version}.` : `Initial version v${newVer} by ${author} awaits its first approval.`} />
      {rev && <Banner tone="info" title={`v${p.version} is Approved and frozen`}>The currently approved version is read-only. This review applies only to the pending revision v{newVer}; approving it does not change operations already pinned to v{p.version}.</Banner>}
      {why && <div className="-mt-2 mb-4"><Locked reason={why} /></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><CardHeader title={rev ? `Step & technique diff: v${p.version} → v${newVer}` : `Steps in reviewed v${newVer}`} sub="Step names only. No command content." />
            <div className="mb-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-ok/10 px-2 py-0.5 text-ok">{added.length} added</span><span className="rounded-full bg-bad/10 px-2 py-0.5 text-bad">{removed.length} removed</span><span className="rounded-full bg-warn/10 px-2 py-0.5 text-warn">{changed.length} changed</span></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><div className="mb-1.5 text-xs font-medium text-muted">{rev ? `Approved v${p.version} (frozen)` : `Submitted v${p.version}`}</div><ol className="space-y-1 rounded-lg border border-line p-3 text-sm">{oldSteps.map((s, i) => <li key={i} className={removed.includes(s) ? 'rounded bg-bad/10 px-1 text-bad line-through' : ''}>{i + 1}. {s}</li>)}</ol></div>
              <div><div className="mb-1.5 text-xs font-medium text-muted">Pending v{newVer}</div><ol className="space-y-1 rounded-lg border border-line p-3 text-sm">{newSteps.map((s, i) => <li key={i} className={added.includes(s) ? 'rounded bg-ok/10 px-1 text-ok' : ''}>{i + 1}. {s}{added.includes(s) && <span className="ml-1 text-[11px]">(added)</span>}</li>)}</ol></div>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {added.map((s) => <li key={'a' + s}><span className="mr-2 rounded bg-ok/10 px-1.5 text-xs font-medium text-ok">Added</span>{s}</li>)}
              {removed.map((s) => <li key={'r' + s}><span className="mr-2 rounded bg-bad/10 px-1.5 text-xs font-medium text-bad">Removed</span>{s}</li>)}
              {changed.map((s) => <li key={'c' + s}><span className="mr-2 rounded bg-warn/10 px-1.5 text-xs font-medium text-warn">Changed</span>{s}</li>)}
              {addedT.map((t) => <li key={'at' + t}><span className="mr-2 rounded bg-ok/10 px-1.5 text-xs font-medium text-ok">Technique added</span><Mono>{t}</Mono> {tName(t)}</li>)}
              {removedT.map((t) => <li key={'rt' + t}><span className="mr-2 rounded bg-bad/10 px-1.5 text-xs font-medium text-bad">Technique removed</span><Mono>{t}</Mono> {tName(t)}</li>)}
              {!added.length && !removed.length && !changed.length && !addedT.length && !removedT.length && <li className="text-muted">No differences detected.</li>}
            </ul>
          </Card>
          <Card><CardHeader title="Risk notes" />
            <ul className="space-y-1.5 text-sm text-muted">{risk.map((r) => <li key={r} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />{r}</li>)}</ul>
            <DescList cols={2} items={[{ k: 'Goal', v: p.goal }, { k: 'Compatible OS', v: p.os.join(' / ') }]} />
          </Card>
          <Card><CardHeader title="Planned use" />
            <p className="text-sm text-muted">{usedOps.length ? `Open operations ${usedOps.join(', ')} are pinned to v${p.version} and are not affected by this review.` : 'No open operation references this playbook.'}</p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card><CardHeader title="Decision" />
            <p className="mb-3 text-xs text-muted">A reason is required for both decisions.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!!why} title={why || `Approve v${newVer}`} onClick={() => decide('approve')}>Approve v{newVer}</Button>
              <Button variant="danger" disabled={!!why} title={why || 'Return the revision to its author as a draft'} onClick={() => decide('return')}>Return to Draft</Button>
              <Button variant="ghost" onClick={() => go('playbook', { id: p.id })}>Back to playbook</Button>
            </div>
          </Card>
          <Card><CardHeader title="Version timeline" /><Timeline items={timeline} /></Card>
        </div>
      </div>
    </>
  )
}

/* ───────────── Technique detail (PB-04, ticket 52: typed service read + Query) ───────────── */
function TechniqueDetail() {
  const { route, go, pid, setFilter } = useStore()
  const read = useTechniqueDetail(route.id)
  if (read.isPending) return <div aria-busy="true" aria-label="Loading technique"><Skeleton className="h-96" /></div>
  if (read.isError || !read.data) return <><PageHeader title="Technique not found" back={{ label: 'MITRE ATT&CK techniques', to: () => go('playbooks', { tab: 'techniques' }) }} /><Empty icon={Crosshair} title={`No technique “${route.id}”`} action={<Button onClick={() => go('playbooks', { tab: 'techniques' })}>Back to catalog</Button>} /></>
  const t = read.data
  const approved = t.playbooks.filter((p) => p.status === 'approved')
  const siemOk = t.siem.connected
  return (
    <>
      <PageHeader back={{ label: 'MITRE ATT&CK techniques', to: () => go('playbooks', { tab: 'techniques' }) }}
        title={<span className="flex flex-wrap items-center gap-3"><Mono className="text-xl text-cyan">{t.id}</Mono>{t.name}</span>} sub={`Tactic: ${t.tactic} · Platforms: ${t.platforms.join(', ')}`}
        actions={<>
          <Button onClick={() => { setFilter('operations.technique', t.id); go('operations') }}>Operations using this technique</Button>
          <Button variant="primary" icon={ExternalLink} onClick={() => go('analysis', { tab: 'matrix' })}>Attack coverage</Button>
        </>} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Related playbooks" value={t.playbooks.length} icon={BookOpen} />
        <Kpi label="Steps executed" value={t.steps.length} sub={pid === 'all' ? 'Across accessible projects' : 'In the selected project'} icon={Layers} />
        <Kpi label="Related findings" value={t.findings.length} icon={AlertTriangle} tone={t.findings.length ? 'warn' : undefined} />
        <Kpi label="Tactic" value={<span className="text-base">{t.tactic}</span>} icon={Crosshair} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card><CardHeader title="About" /><p className="text-sm text-fg/90">{t.desc}</p><p className="mt-2 text-xs text-muted">Based on the integrated catalog and simulated data. It does not claim any test result by itself.</p></Card>
          <Card><CardHeader title="References" />
            <ul className="space-y-1 text-sm"><li className="flex items-center gap-2"><ExternalLink size={13} aria-hidden /><span>MITRE ATT&CK catalog entry <Mono>{t.id}</Mono> (reference only, link not followed in the prototype)</span></li></ul>
          </Card>
          <Card><CardHeader title="Approved simulations" sub="Approved playbooks that exercise this technique." />
            {approved.length ? <ul className="space-y-2">{approved.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0"><IdLink onClick={() => go('playbook', { id: p.id })}>{p.id}</IdLink> <span className="text-muted">{p.name}</span></span><PbStatus s={p.status} /></li>)}</ul> : <p className="text-sm text-muted">No approved simulation covers this technique yet. Draft playbooks must be approved first.</p>}
          </Card>
          <Card><CardHeader title="Test results in projects" sub={pid === 'all' ? 'Aggregated across projects you can access' : `Project ${pid}`} />
            <Table dense rows={t.steps} rowKey={(r) => r.opId + r.stepId} onRow={(r) => go('operation', { id: r.opId })}
              empty={<Empty icon={Crosshair} title="No test data yet">No step in the current scope has exercised this technique.</Empty>}
              cols={[{ key: 'o', header: 'Operation', render: (r) => <Mono className="text-accent">{r.opId}</Mono> }, { key: 's', header: 'Step', render: (r) => r.name }, { key: 'a', header: 'Asset', hideBelow: 'md', render: (r) => <Mono>{r.asset}</Mono> }, { key: 'st', header: 'Result', render: (r) => <Status kind="step" value={r.status} /> }]} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card><CardHeader title="Detection status" />
            {!siemOk ? <p className="text-sm text-muted">No detection data: the {t.siem.name || 'SIEM'} integration is not connected.</p> : !t.detection.length ? <p className="text-sm text-muted">Select a project to see detection status.</p> : (
              <ul className="space-y-2">{t.detection.map(({ projectId, state }) => <li key={projectId} className="flex items-center justify-between gap-2 text-sm"><span className="truncate"><Mono className="text-muted">{projectId}</Mono></span><Status kind="detect" value={state} /></li>)}</ul>
            )}
            <p className="mt-3 text-xs text-muted">“No data” means not tested or no signal received. It does not mean “detected”.</p>
          </Card>
          <Card><CardHeader title="Playbooks using this technique" />
            {t.playbooks.length ? <ul className="space-y-2">{t.playbooks.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0"><IdLink onClick={() => go('playbook', { id: p.id })}>{p.id}</IdLink> <span className="text-muted">{p.name}</span></span><PbStatus s={p.status} /></li>)}</ul> : <p className="text-sm text-muted">No playbook uses this technique yet.</p>}
          </Card>
          {t.findings.length > 0 && <Card><CardHeader title="Related findings" /><ul className="space-y-2">{t.findings.map((f) => <li key={f.id} className="flex items-center justify-between gap-2 text-sm"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="sev" value={f.severity} /></li>)}</ul></Card>}
        </div>
      </div>
    </>
  )
}

export const libraryRoutes = { playbooks: withLoading(Playbooks), playbook: withLoading(PlaybookDetail), technique: withLoading(TechniqueDetail), 'playbook-review': withLoading(PlaybookReview) }
