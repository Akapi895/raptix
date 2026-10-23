/* eslint-disable react-refresh/only-export-components -- library route bundle: sub-screens co-exported for the registry */
import { useEffect, useState } from 'react'
import { BookOpen, Bot, Database, Download, Plug, RotateCcw, Send, ShieldCheck, Wrench } from 'lucide-react'
import { Banner, Button, Card, CardHeader, Col, cx, DescList, Empty, Field, Input, Mono, PageHeader, Pager, SearchBox, Select, Skeleton, Status, Table, Tabs, Textarea } from '../../../ui/index'
import { withLoading } from '../../../ui/d-shared'
import { LibraryReadError, useLibraryCorpus, useLibraryProposal, useLibraryProposals, useLibraryWrites, useSkillDetail, useTechniqueDetail } from '../query'
import type { LibraryProposal, LibraryProposalStatus, LibrarySkill } from '../service';
import { go, useRoute } from '../../../router/navigate'
import { useMe } from '../../../state/console'
import { useQueryScope } from '../../../state/keys'
import { FilterChip, StatTile } from './capability-ui'
import { KnowledgeTab, McpTab, SpecialistsTab, ToolsTab } from './capability-tabs'
import { useToastStore } from '../../../state/stores'

/** Roles that may decide a proposal (server: reviewer and above; the author never decides their own). */
const DECIDE_ROLES: readonly string[] = ['admin', 'manager', 'reviewer']

const STATUS_LABEL: Record<LibraryProposalStatus, string> = { draft: 'Draft', proposed: 'In review', approved: 'Approved', rejected: 'Rejected' }

function ProposalStatus({ s }: { s: LibraryProposalStatus }) {
  return s === 'approved' ? <Status kind="check" value="pass" label="Approved" /> : s === 'proposed' ? <Status kind="report" value="review" label="In review" /> : <Status kind="report" value="draft" label={STATUS_LABEL[s]} />
}

function readMessage(error: unknown): string {
  return error instanceof LibraryReadError ? error.failure.message : error instanceof Error ? error.message : 'The library could not be read.'
}

/* ───────────── Skill corpus (read-only) ───────────── */

/** Plain-language labels for the corpus actions the runtime excludes; an unknown id is shown as the server sent it. */
const EXCLUDED_ACTION_LABEL: Record<string, string> = {
  'skill-revision-submit': 'submitting a skill revision',
  'skill-revision-review': 'reviewing a skill revision',
}

/** Queue statuses in review order, each figure in the tone the review flow uses for it. */
const QUEUE: { status: LibraryProposalStatus; label: string; figure: string }[] = [
  { status: 'draft', label: 'Draft', figure: 'text-neutral' },
  { status: 'proposed', label: 'In review', figure: 'text-warn' },
  { status: 'approved', label: 'Approved', figure: 'text-ok' },
  { status: 'rejected', label: 'Rejected', figure: 'text-bad' },
]

/** The console is scoped to one engagement unless it shows all projects; proposals exist only per engagement. */
function hasEngagement(project: string): boolean {
  return project !== '' && project !== 'all'
}

function coverageNote(covered: number, techniques: number | null): string {
  if (techniques === null) return 'Referenced by corpus skills'
  if (techniques === 0) return 'No techniques recorded'
  return `${Math.min(100, Math.round((covered / techniques) * 100))}% of ${techniques} techniques`
}

/** Proposal counts by status, shared by the library page and the proposals list. */
function QueueCounts({ counts }: { counts: Record<LibraryProposalStatus, number> }) {
  return (
    <dl className="flex flex-wrap gap-2">
      {QUEUE.map((q) => (
        <div key={q.status} className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5">
          <dt className="text-sm text-muted">{q.label}</dt>
          <dd className={cx('text-lg font-semibold tabular-nums', counts[q.status] === 0 ? 'text-muted opacity-50' : q.figure)}>{counts[q.status]}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The review queue of the active engagement. Without an engagement it says so instead of reporting an error. */
function ReviewQueue() {
  const scope = useQueryScope()
  const engaged = hasEngagement(scope.project)
  const proposals = useLibraryProposals(engaged)
  if (!engaged) return <p className="mb-4 rounded-xl border border-line bg-panel p-4 text-sm text-muted">Select an engagement to see its review queue.</p>
  if (proposals.isPending) return <Skeleton className="mb-4 h-20" />
  if (proposals.isError) return <Banner tone="warn" title="Review queue unavailable">{readMessage(proposals.error)}</Banner>
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="font-medium">Review queue</div>
          <div className="text-sm text-muted">Proposals in <Mono>{scope.project}</Mono></div>
        </div>
        <QueueCounts counts={proposals.data.counts} />
        <Button size="sm" icon={Send} onClick={() => go('playbook-review')}>Open queue</Button>
      </div>
    </Card>
  )
}

/** Technique ids of one skill; the first three show, the rest collapse into a count. */
function TechniqueIds({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="text-muted">None</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.slice(0, 3).map((id) => <Mono key={id} className="rounded bg-subtle px-1.5 py-0.5 text-xs">{id}</Mono>)}
      {ids.length > 3 && <span className="text-xs text-muted">+{ids.length - 3}</span>}
    </div>
  )
}

const SKILL_COLS: Col<LibrarySkill>[] = [
  {
    key: 'skill',
    header: 'Skill',
    render: (skill) => (
      <div className="min-w-0 py-2">
        <div className="font-medium text-accent">{skill.name}</div>
        {skill.description && <div className="line-clamp-2 max-w-prose text-xs text-muted">{skill.description}</div>}
      </div>
    ),
  },
  {
    key: 'subdomain',
    header: 'Subdomain',
    render: (skill) => skill.subdomain ? <span className="rounded-full bg-subtle px-2.5 py-0.5 text-xs text-muted">{skill.subdomain}</span> : <span className="text-muted">None</span>,
  },
  { key: 'techniques', header: 'Techniques', render: (skill) => <TechniqueIds ids={skill.mitreIds} /> },
  {
    key: 'source',
    header: 'Source',
    hideBelow: 'lg',
    render: (skill) => skill.path ? <Mono className="text-xs text-muted">{skill.path}</Mono> : <span className="text-muted">Not recorded</span>,
  },
]

function Playbooks() {
  const [q, setQ] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [mitre, setMitre] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [q, subdomain, mitre])
  const corpus = useLibraryCorpus({ q: q || undefined, subdomain: subdomain || undefined, mitre: mitre || undefined, page })
  const data = corpus.data
  const filtered = q !== '' || subdomain !== '' || mitre !== ''
  const subdomains = data ? Object.entries(data.subdomains).sort(([a], [b]) => a.localeCompare(b)) : []
  const reset = () => { setQ(''); setSubdomain(''); setMitre('') }
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={Send} onClick={() => go('playbook-review')}>Review proposals</Button>
      </div>
      {corpus.isError && <Banner tone="bad" title="Skill library unavailable">{readMessage(corpus.error)}</Banner>}
      {data && (
        <Banner tone="info" title="Read-only corpus">
          Skills change only through review and the runtime&apos;s git gates.
          {data.excludedActions.length > 0 && ` Excluded from this library: ${data.excludedActions.map((action) => EXCLUDED_ACTION_LABEL[action] ?? action).join(', ')}.`}
        </Banner>
      )}
      {data ? (
        <div className="mb-4 grid gap-4 md:grid-cols-3">
          <StatTile label="Skills in corpus" value={data.counts.skills} note="Canonical SKILL.md files" />
          <StatTile label="Subdomains" value={subdomains.length} note="Skills grouped by subdomain" />
          <StatTile label="Techniques covered" value={data.techniquesCovered} note={coverageNote(data.techniquesCovered, data.counts.techniques)} tone="ok" />
        </div>
      ) : corpus.isPending ? <Skeleton className="mb-4 h-28" /> : null}
      <ReviewQueue />
      <div className={cx('mb-4 rounded-xl border bg-panel p-2 shadow-sm', filtered ? 'border-primary/40' : 'border-line')}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search name or description…" className="min-w-[14rem] flex-1" />
          <Input aria-label="MITRE technique" value={mitre} onChange={(e) => setMitre(e.target.value)} placeholder="Technique ID, e.g. T1190" className="min-w-[12rem] flex-1 sm:flex-none" />
          {filtered && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset all</Button>}
        </div>
        {data && (
          <div role="group" aria-label="Subdomains" className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <span className="text-xs text-muted">Subdomain</span>
            <FilterChip label="All" count={data.counts.skills} active={subdomain === ''} onClick={() => setSubdomain('')} />
            {subdomains.map(([name, count]) => (
              <FilterChip key={name} label={name} count={count} active={subdomain === name} onClick={() => setSubdomain(subdomain === name ? '' : name)} />
            ))}
          </div>
        )}
      </div>
      {corpus.isPending ? <Skeleton className="h-64" /> : data && (
        <>
          <Table
            rows={data.items}
            rowKey={(skill) => skill.name}
            onRow={(skill) => go('playbook', { id: skill.name })}
            empty={<Empty icon={BookOpen} title="No skills match">Clear the filters to see the canonical corpus.</Empty>}
            cols={SKILL_COLS}
          />
          <Pager page={data.page} pages={Math.max(1, Math.ceil(data.total / data.pageSize))} setPage={setPage} total={data.total} />
        </>
      )}
    </>
  )
}

function PlaybookDetail() {
  const route = useRoute()
  const skill = useSkillDetail(route.id)
  const scope = useQueryScope()
  const engaged = hasEngagement(scope.project)
  const proposals = useLibraryProposals(engaged)
  if (skill.isPending) return <Skeleton className="h-64" />
  if (skill.isError || !skill.data) return <Banner tone="bad" title="Skill unavailable">{readMessage(skill.error)}</Banner>
  const s = skill.data
  const related = (proposals.data?.items ?? []).filter((p) => p.skillName === s.name)
  return (
    <>
      <PageHeader title={s.name} sub={s.description ?? 'Canonical skill'} back={{ label: 'Skills', to: () => go('capabilities', { tab: 'skills' }) }}
        actions={<Button icon={Send} onClick={() => go('playbook-review', { tab: 'new', id: s.name })}>Propose a change</Button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="SKILL.md" sub="The canonical body, exactly as the corpus holds it." />
          <pre className="whitespace-pre-wrap p-4 text-sm">{s.body}</pre>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Provenance" />
            <DescList items={[
              { k: 'Path', v: <Mono>{s.path ?? 'not recorded'}</Mono> },
              { k: 'Content fingerprint', v: <Mono>{s.contentSha256 ?? 'not recorded by the source'}</Mono> },
              { k: 'Commit', v: <Mono>{s.commitSha ?? 'not recorded by the source'}</Mono> },
              { k: 'Allowed tools', v: s.allowedTools.length === 0 ? 'None declared' : s.allowedTools.join(', ') },
              { k: 'When to use', v: s.whenToUse ?? 'Not recorded' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Proposals for this skill" sub="Engagement-scoped replacement proposals. None of them changes the corpus." />
            {!engaged ? (
              <p className="p-4 text-sm text-muted">Select an engagement to see the proposals for this skill.</p>
            ) : proposals.isError ? (
              <Banner tone="warn" title="Proposals unavailable">{readMessage(proposals.error)}</Banner>
            ) : related.length === 0 ? (
              <p className="p-4 text-sm text-muted">No proposal for this skill in the active engagement.</p>
            ) : (
              <ul className="divide-y divide-line">
                {related.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <button className="text-accent underline-offset-2 hover:underline" onClick={() => go('playbook-review', { id: p.id })}>{p.id} · v{p.version}</button>
                    <ProposalStatus s={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function TechniqueDetail() {
  const route = useRoute()
  const technique = useTechniqueDetail(route.id)
  if (technique.isPending) return <Skeleton className="h-40" />
  if (technique.isError || !technique.data) return <Banner tone="bad" title="Technique unavailable">{readMessage(technique.error)}</Banner>
  const t = technique.data
  return (
    <>
      <PageHeader title={`${t.id}${t.name ? ` · ${t.name}` : ''}`} sub={t.description ?? 'MITRE ATT&CK technique'} back={{ label: 'Skills', to: () => go('capabilities', { tab: 'skills' }) }} />
      <Card>
        <CardHeader title="Skills that use this technique" />
        {t.skills.length === 0 ? <p className="p-4 text-sm text-muted">No corpus skill references this technique.</p> : (
          <ul className="divide-y divide-line">
            {t.skills.map((skill) => (
              <li key={skill.name} className="p-3"><button className="text-accent underline-offset-2 hover:underline" onClick={() => go('playbook', { id: skill.name })}>{skill.name}</button></li>
            ))}
          </ul>
        )}
        {t.url && <p className="p-4 text-sm"><a className="underline" href={t.url} target="_blank" rel="noreferrer">MITRE ATT&CK reference</a></p>}
      </Card>
    </>
  )
}

/* ───────────── Proposals (engagement-scoped review workflow) ───────────── */

function ProposalsPage({ newSkill }: { newSkill?: string }) {
  const proposals = useLibraryProposals()
  if (newSkill !== undefined) return <NewProposal skillName={newSkill} />
  const counts = proposals.data?.counts
  return (
    <>
      <PageHeader title="Library proposals" sub="Replacement SKILL.md bodies for this engagement. Approval records a decision; it never edits the canonical corpus." back={{ label: 'Skills', to: () => go('capabilities', { tab: 'skills' }) }}
        actions={<Button variant="primary" icon={Send} onClick={() => go('playbook-review', { tab: 'new' })}>New proposal</Button>} />
      {proposals.isError && <Banner tone="bad" title="Proposals unavailable">{readMessage(proposals.error)}</Banner>}
      {counts && <div className="mb-4"><QueueCounts counts={counts} /></div>}
      {proposals.isPending ? <Skeleton className="h-40" /> : proposals.data && proposals.data.items.length === 0 ? (
        <Empty icon={BookOpen} title="No proposals yet">Propose a replacement for a corpus skill to start the review.</Empty>
      ) : proposals.data && (
        <Card>
          <ul className="divide-y divide-line">
            {proposals.data.items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <button className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => go('playbook-review', { id: p.id })}>{p.skillName}</button>
                  <p className="text-xs text-neutral">{p.id} · v{p.version} · by {p.createdBy}</p>
                </div>
                <ProposalStatus s={p.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function NewProposal({ skillName }: { skillName: string }) {
  const toast = useToastStore((s) => s.toast)
  const corpus = useLibraryCorpus({ pageSize: 100 })
  const current = useSkillDetail(skillName || undefined)
  const writes = useLibraryWrites()
  const [skill, setSkill] = useState(skillName)
  const [body, setBody] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (current.data && body === '') setBody(current.data.body) }, [current.data, body])
  const submit = async () => {
    const res = await writes.submit({ skillName: skill, proposedBody: body, rationale: rationale.trim() || undefined })
    if (!res.ok) { setError(res.failure.message); return }
    toast('Proposal drafted', 'ok')
    go('playbook-review', { id: res.data.id })
  }
  return (
    <>
      <PageHeader title="New proposal" sub="Start from the current canonical body, edit it, then propose it for independent review." back={{ label: 'Proposals', to: () => go('playbook-review') }} />
      <Card>
        <div className="space-y-4 p-4">
          <Field label="Skill">
            <Select value={skill} onChange={(e) => { setSkill(e.target.value); setBody('') }}>
              <option value="">Choose a corpus skill</option>
              {(corpus.data?.items ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </Select>
          </Field>
          {skill && <Button size="sm" onClick={() => current.data && setBody(current.data.body)} disabled={!current.data}>Load current canonical body</Button>}
          <Field label="Proposed SKILL.md body"><Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="Rationale (optional)"><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button variant="primary" disabled={!skill || body.trim().length === 0} onClick={() => void submit()}>Save draft</Button>
        </div>
      </Card>
    </>
  )
}

function ProposalDetail({ id }: { id: string }) {
  const proposal = useLibraryProposal(id)
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const writes = useLibraryWrites()
  const [error, setError] = useState<string | null>(null)
  const [amendBody, setAmendBody] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  if (proposal.isPending) return <Skeleton className="h-64" />
  if (proposal.isError || !proposal.data) return <Banner tone="bad" title="Proposal unavailable">{readMessage(proposal.error)}</Banner>
  const p: LibraryProposal = proposal.data
  const canDecide = p.status === 'proposed' && DECIDE_ROLES.includes(me.role)
  const run = async (label: string, action: () => Promise<{ ok: true } | { ok: false; failure: { message: string } }>) => {
    setError(null)
    const res = await action()
    if (!res.ok) { setError(res.failure.message); return }
    toast(label, 'ok')
    void proposal.refetch()
  }
  const exportProposal = async () => {
    const res = await writes.exportProposal(p.id)
    if (!res.ok) { setError(res.failure.message); return }
    const url = URL.createObjectURL(new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `library-proposal-${p.id}-v${p.version}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <PageHeader title={`${p.skillName} · ${p.id}`} sub={`v${p.version} · ${STATUS_LABEL[p.status]}`} back={{ label: 'Proposals', to: () => go('playbook-review') }} actions={<ProposalStatus s={p.status} />} />
      {p.canonicalCurrent === false && <Banner tone="warn" title="The canonical skill changed">The corpus changed after this proposal was pinned. Amend it against the current content before review.</Banner>}
      {error && <p role="alert" className="mb-4 text-sm text-bad">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Canonical body" sub={`Pinned revision ${p.baseRevision.slice(0, 12)}`} />
          <pre className="whitespace-pre-wrap p-4 text-sm">{p.baseBody}</pre>
        </Card>
        <Card>
          <CardHeader title="Proposed body" sub={p.rationale ?? 'No rationale recorded'} />
          <pre className="whitespace-pre-wrap p-4 text-sm">{p.proposedBody}</pre>
        </Card>
      </div>
      <Card className="mt-4">
        <div className="space-y-4 p-4">
          {p.status === 'draft' && (
            <>
              <Field label="Amend the proposed body"><Textarea rows={10} value={amendBody ?? p.proposedBody} onChange={(e) => setAmendBody(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button disabled={amendBody === null || amendBody.trim().length === 0} onClick={() => void run('Amendment saved', async () => { const r = await writes.amend(p.id, { proposedBody: amendBody ?? '', expectedVersion: p.version }); return r.ok ? { ok: true as const } : { ok: false as const, failure: r.failure } })}>Save amendment</Button>
                <Button variant="primary" icon={Send} onClick={() => void run('Proposal submitted for review', async () => { const r = await writes.propose(p.id); return r.ok ? { ok: true as const } : { ok: false as const, failure: r.failure } })}>Propose for review</Button>
              </div>
            </>
          )}
          {canDecide && (
            <>
              <Field label="Decision comment"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button variant="primary" icon={ShieldCheck} onClick={() => void run('Proposal approved', async () => { const r = await writes.decide(p.id, { decision: 'approved', expectedVersion: p.version, comment: comment.trim() || undefined }); return r.ok ? { ok: true as const } : { ok: false as const, failure: r.failure } })}>Approve</Button>
                <Button onClick={() => void run('Proposal rejected', async () => { const r = await writes.decide(p.id, { decision: 'rejected', expectedVersion: p.version, comment: comment.trim() || undefined }); return r.ok ? { ok: true as const } : { ok: false as const, failure: r.failure } })}>Reject</Button>
              </div>
            </>
          )}
          {p.status === 'approved' && <Button icon={Download} onClick={() => void exportProposal()}>Export for git publication</Button>}
          {p.status === 'proposed' && !canDecide && <p className="text-sm text-muted">Only a reviewer who did not write this proposal can decide it.</p>}
          {p.reviews.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {p.reviews.map((r) => <li key={r.id} className="py-2">v{r.proposalVersion}: {r.decision}{r.comment ? ` — ${r.comment}` : ''} <span className="text-neutral">({r.reviewerId})</span></li>)}
            </ul>
          )}
        </div>
      </Card>
    </>
  )
}

function PlaybookReview() {
  const route = useRoute()
  if (route.tab === 'new') return <ProposalsPage newSkill={route.id ?? ''} />
  if (route.id) return <ProposalDetail id={route.id} />
  return <ProposalsPage />
}

/* ───────────── Capabilities (tabs) ───────────── */

const CAPABILITY_TABS = [
  { id: 'specialists', label: 'Specialists', icon: Bot },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'knowledge', label: 'Knowledge', icon: Database },
  { id: 'mcp', label: 'MCP', icon: Plug },
  { id: 'tool', label: 'Tool', icon: Wrench },
]

/** The capabilities section: one tab per kind of capability; the tab is kept in the route. */
function Capabilities() {
  const route = useRoute()
  const tab = CAPABILITY_TABS.find((t) => t.id === route.tab)?.id ?? 'skills'
  return (
    <>
      <PageHeader title="Capabilities" sub="What the console can reference: specialist agents, skills, knowledge, MCP servers and tools." />
      <Tabs tabs={CAPABILITY_TABS} value={tab} onChange={(id) => go('capabilities', { tab: id })} />
      {tab === 'specialists' && <SpecialistsTab />}
      {tab === 'skills' && <Playbooks />}
      {tab === 'knowledge' && <KnowledgeTab />}
      {tab === 'mcp' && <McpTab />}
      {tab === 'tool' && <ToolsTab />}
    </>
  )
}

export const capabilityRoutes = { capabilities: withLoading(Capabilities), playbook: withLoading(PlaybookDetail), technique: withLoading(TechniqueDetail), 'playbook-review': withLoading(PlaybookReview) }
