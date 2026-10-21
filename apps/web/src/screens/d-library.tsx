/* eslint-disable react-refresh/only-export-components -- library route bundle: sub-screens co-exported for the registry */
import { useEffect, useState } from 'react'
import { BookOpen, Download, Send, ShieldCheck } from 'lucide-react'
import { Banner, Button, Card, CardHeader, DescList, Empty, Field, Input, Mono, PageHeader, Select, Skeleton, Status, Textarea } from '../ui/index'
import { withLoading } from './d-shared'
import { LibraryReadError, useLibraryCorpus, useLibraryProposal, useLibraryProposals, useLibraryWrites, useSkillDetail, useTechniqueDetail } from '../features/library/query'
import type { LibraryProposal, LibraryProposalStatus } from '../features/library/service'
import { go, useRoute } from '../router/navigate'
import { useMe } from '../state/console'
import { useToastStore } from '../state/stores'

/** Roles that may decide a proposal (server: reviewer and above; the author never decides their own). */
const DECIDE_ROLES: readonly string[] = ['admin', 'manager', 'reviewer']
const PAGE_SIZE = 10

const STATUS_LABEL: Record<LibraryProposalStatus, string> = { draft: 'Draft', proposed: 'In review', approved: 'Approved', rejected: 'Rejected' }

function ProposalStatus({ s }: { s: LibraryProposalStatus }) {
  return s === 'approved' ? <Status kind="check" value="pass" label="Approved" /> : s === 'proposed' ? <Status kind="report" value="review" label="In review" /> : <Status kind="report" value="draft" label={STATUS_LABEL[s]} />
}

function readMessage(error: unknown): string {
  return error instanceof LibraryReadError ? error.failure.message : error instanceof Error ? error.message : 'The library could not be read.'
}

/* ───────────── Skill corpus (read-only) ───────────── */

function Playbooks() {
  const [q, setQ] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [mitre, setMitre] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [q, subdomain, mitre])
  const corpus = useLibraryCorpus({ q: q || undefined, subdomain: subdomain || undefined, mitre: mitre || undefined, page })
  return (
    <>
      <PageHeader title="Skill library" sub="Canonical skills. The corpus is read-only here: changes are proposed in the review workflow and published by the runtime's git gates." back={{ label: 'Projects', to: () => go('projects') }}
        actions={<Button icon={Send} onClick={() => go('playbook-review')}>Review proposals</Button>} />
      {corpus.isError && <Banner tone="bad" title="Skill library unavailable">{readMessage(corpus.error)}</Banner>}
      {corpus.data && corpus.data.excludedActions.length > 0 && (
        <Banner tone="info" title="Excluded from the library">{corpus.data.excludedActions.join(' ')}</Banner>
      )}
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or description" /></Field>
          <Field label="Subdomain">
            <Select value={subdomain} onChange={(e) => setSubdomain(e.target.value)}>
              <option value="">All subdomains</option>
              {(corpus.data?.subdomains ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="MITRE technique"><Input value={mitre} onChange={(e) => setMitre(e.target.value)} placeholder="e.g. T1190" /></Field>
        </div>
      </Card>
      {corpus.isPending ? <Skeleton className="h-40" /> : corpus.data && corpus.data.items.length === 0 ? (
        <Empty icon={BookOpen} title="No skills match">Clear the filters to see the canonical corpus.</Empty>
      ) : corpus.data && (
        <Card>
          <CardHeader title={`${corpus.data.total} skills`} sub={`${corpus.data.counts.skills} in the corpus${corpus.data.counts.techniques === null ? '' : `, ${corpus.data.counts.techniques} techniques`}.`} />
          <ul className="divide-y divide-line">
            {corpus.data.items.map((skill) => (
              <li key={skill.name} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <button className="text-left font-medium text-accent underline-offset-2 hover:underline" onClick={() => go('playbook', { id: skill.name })}>{skill.name}</button>
                  {skill.description && <p className="text-sm text-muted">{skill.description}</p>}
                  <p className="text-xs text-neutral">{skill.subdomain ?? 'No subdomain'} · {skill.mitreIds.length === 0 ? 'No techniques' : skill.mitreIds.join(', ')}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line p-4 text-sm">
            <Button size="sm" disabled={corpus.data.page <= 1} onClick={() => setPage(corpus.data!.page - 1)}>Previous</Button>
            <span className="text-muted">Page {corpus.data.page} of {Math.max(1, Math.ceil(corpus.data.total / PAGE_SIZE))}</span>
            <Button size="sm" disabled={corpus.data.page * PAGE_SIZE >= corpus.data.total} onClick={() => setPage(corpus.data!.page + 1)}>Next</Button>
          </div>
        </Card>
      )}
    </>
  )
}

function PlaybookDetail() {
  const route = useRoute()
  const skill = useSkillDetail(route.id)
  const proposals = useLibraryProposals()
  if (skill.isPending) return <Skeleton className="h-64" />
  if (skill.isError || !skill.data) return <Banner tone="bad" title="Skill unavailable">{readMessage(skill.error)}</Banner>
  const s = skill.data
  const related = (proposals.data?.items ?? []).filter((p) => p.skillName === s.name)
  return (
    <>
      <PageHeader title={s.name} sub={s.description ?? 'Canonical skill'} back={{ label: 'Skill library', to: () => go('playbooks') }}
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
            {proposals.isError ? <Banner tone="warn" title="Proposals unavailable">{readMessage(proposals.error)}</Banner> : related.length === 0 ? (
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
      <PageHeader title={`${t.id}${t.name ? ` · ${t.name}` : ''}`} sub={t.description ?? 'MITRE ATT&CK technique'} back={{ label: 'Skill library', to: () => go('playbooks') }} />
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
      <PageHeader title="Library proposals" sub="Replacement SKILL.md bodies for this engagement. Approval records a decision; it never edits the canonical corpus." back={{ label: 'Skill library', to: () => go('playbooks') }}
        actions={<Button variant="primary" icon={Send} onClick={() => go('playbook-review', { tab: 'new' })}>New proposal</Button>} />
      {proposals.isError && <Banner tone="bad" title="Proposals unavailable">{readMessage(proposals.error)}</Banner>}
      {counts && (
        <p className="mb-4 text-sm text-muted">{counts.draft} draft · {counts.proposed} in review · {counts.approved} approved · {counts.rejected} rejected</p>
      )}
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

export const libraryRoutes = { playbooks: withLoading(Playbooks), playbook: withLoading(PlaybookDetail), technique: withLoading(TechniqueDetail), 'playbook-review': withLoading(PlaybookReview) }
