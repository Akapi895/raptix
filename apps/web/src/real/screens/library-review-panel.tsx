/**
 * ADR-0070 engagement-scoped library review surface. Proposals pin the
 * canonical corpus snapshot at submission; amendment is author-only and
 * version-pinned; decisions require an independent reviewer. The export is a
 * reviewed JSON artifact for the existing git publication workflow — this
 * surface never mutates the skill corpus.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import {
  amendLibraryProposal, decideLibraryProposal, exportLibraryProposal,
  fetchLibraryProposal, fetchLibraryProposals, proposeLibraryProposal, submitLibraryProposal,
} from '../api'
import type { LibraryProposalExportView, LibraryProposalView } from '../api'
import { Banner, Button, Card, CardHeader, Empty, Input, Skeleton, Status, Textarea } from '../../ui'

export function RealLibraryReviewPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const proposals = useQuery({ queryKey: ['real', 'library-proposals', engagementId], queryFn: () => fetchLibraryProposals(engagementId), retry: false })
  const [skillName, setSkillName] = useState('')
  const [proposedBody, setProposedBody] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['real', 'library-proposals', engagementId] }) }
  const submit = useMutation({
    mutationFn: () => submitLibraryProposal(engagementId, { skillName: skillName.trim(), proposedBody, ...(rationale.trim() === '' ? {} : { rationale: rationale.trim() }) }),
    onSuccess: () => { setSkillName(''); setProposedBody(''); setRationale(''); setError(null); invalidate() },
    onError: (err) => setError(err instanceof Error ? err.message : 'The proposal was refused.'),
  })

  if (proposals.isPending) {
    return <Card><CardHeader title="Library review proposals" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (proposals.isError || !proposals.data) {
    return <Empty icon={BookOpen} title="Library proposals are unavailable" action={<Button onClick={() => void proposals.refetch()}>Retry</Button>}>
      {proposals.error instanceof Error ? proposals.error.message : 'The proposal read failed.'}
    </Empty>
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Library review proposals" sub="Body-replacement proposals pinned to the canonical skill snapshot; decisions are independent and version-pinned" />
        <div className="p-4">
          {proposals.data.proposals.length === 0 ? (
            <p className="text-sm text-muted">No proposals yet. Submit a body replacement for a canonical corpus skill below.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Skill</th><th className="pb-2">Status</th><th className="pb-2">Version</th>
                  <th className="pb-2">Pinned revision</th><th className="pb-2">By</th><th className="pb-2">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {proposals.data.proposals.map((p) => <ProposalRow key={p.id} proposal={p} engagementId={engagementId} onChanged={() => { setError(null); invalidate() }} onError={setError} />)}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="New proposal" sub="Pins the current canonical skill body as the base; the runtime loader never reads these records" />
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit.mutate() }}>
          <label className="text-sm text-muted" htmlFor="proposal-skill">Canonical skill name</label>
          <Input id="proposal-skill" required value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="dcsync" />
          <label className="text-sm text-muted" htmlFor="proposal-rationale">Rationale (optional)</label>
          <Input id="proposal-rationale" maxLength={500} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Tighten the OPSEC paragraph" />
          <label className="text-sm text-muted sm:col-span-2" htmlFor="proposal-body">Proposed SKILL.md body</label>
          <div className="sm:col-span-2"><Textarea id="proposal-body" required rows={6} value={proposedBody} onChange={(e) => setProposedBody(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" icon={BookOpen} disabled={submit.isPending}>
              {submit.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Submit proposal
            </Button>
          </div>
        </form>
      </Card>

      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
    </div>
  )
}

function ProposalRow({ proposal, engagementId, onChanged, onError }: {
  proposal: LibraryProposalView
  engagementId: string
  onChanged: () => void
  onError: (message: string) => void
}): ReactElement {
  // W18: the authoritative detail read (by proposal id) carries the
  // canonical state and is the review surface for base/proposed/diff.
  const [open, setOpen] = useState(false)
  const detail = useQuery({
    queryKey: ['real', 'library-proposal', engagementId, proposal.id],
    queryFn: () => fetchLibraryProposal(engagementId, proposal.id),
    enabled: open,
    retry: false,
  })
  const [body, setBody] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [exported, setExported] = useState<LibraryProposalExportView | null>(null)
  const busy = useMutation({
    mutationFn: async (action: { kind: 'amend' } | { kind: 'propose' } | { kind: 'decide'; decision: 'approved' | 'rejected' } | { kind: 'export' }) => {
      if (action.kind === 'amend') return amendLibraryProposal(engagementId, proposal.id, { proposedBody: body ?? proposal.proposedBody, expectedVersion: proposal.version })
      if (action.kind === 'propose') return proposeLibraryProposal(engagementId, proposal.id)
      if (action.kind === 'decide') return decideLibraryProposal(engagementId, proposal.id, { decision: action.decision, expectedVersion: proposal.version, ...(comment.trim() === '' ? {} : { comment: comment.trim() }) })
      setExported(await exportLibraryProposal(engagementId, proposal.id))
      return null
    },
    onSuccess: () => { setComment(''); onChanged() },
    onError: (err) => onError(err instanceof Error ? err.message : 'The proposal action was refused.'),
  })
  const current = detail.data ?? proposal
  // W18: a reviewer cannot approve a version whose diff they have not seen.
  const seenDiff = open && detail.data !== undefined
  const drifted = current.canonicalCurrent === false

  const downloadExport = (): void => {
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `library-proposal-${exported?.proposal.skillName ?? proposal.skillName}-v${exported?.proposal.version ?? proposal.version}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="py-2 pr-3 text-xs font-medium">{current.skillName}<div className="font-mono text-[10px] text-muted">{current.baseRevision.slice(0, 12)}</div></td>
        <td className="py-2 pr-3"><Status kind="gate" value={current.status === 'approved' ? 'passed' : current.status === 'rejected' ? 'failed' : 'pending'} size="sm" label={`v${current.version} ${current.status}`} /></td>
        <td className="py-2 pr-3 text-xs">{current.version}</td>
        <td className="py-2 pr-3 text-xs">{current.createdBy}</td>
        <td className="py-2 pr-3 text-xs">{current.reviews.length === 0 ? <span className="text-muted">—</span> : current.reviews.map((r) => <div key={r.id} className="text-[10px]">{r.decision} by {r.reviewerId}{r.comment ? `: ${r.comment.slice(0, 60)}` : ''}</div>)}</td>
        <td className="py-2 text-xs">
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy.isPending} onClick={() => setOpen((v) => !v)}>Review diff</Button>
            {current.status === 'draft' && <Button variant="secondary" disabled={busy.isPending} onClick={() => setBody(body ?? current.proposedBody)}>Edit</Button>}
            {current.status === 'draft' && <Button variant="secondary" disabled={busy.isPending} onClick={() => busy.mutate({ kind: 'propose' })}>Propose</Button>}
            {current.status === 'proposed' && <Button variant="secondary" disabled={busy.isPending || !seenDiff} onClick={() => busy.mutate({ kind: 'decide', decision: 'approved' })}>Approve</Button>}
            {current.status === 'proposed' && <Button variant="secondary" disabled={busy.isPending || !seenDiff} onClick={() => busy.mutate({ kind: 'decide', decision: 'rejected' })}>Reject</Button>}
            {current.status === 'approved' && exported !== null && <Button variant="secondary" disabled={busy.isPending} onClick={downloadExport}>Download JSON</Button>}
            {current.status === 'approved' && exported === null && <Button variant="secondary" disabled={busy.isPending} onClick={() => busy.mutate({ kind: 'export' })}>Export</Button>}
          </span>
        </td>
      </tr>
      {drifted && (
        <tr><td colSpan={6} className="pb-2">
          <Banner tone="warn" title={`Canonical corpus changed since v${current.version} was pinned`}>
            Amend the proposal against the current canonical content before review or export.
          </Banner>
        </td></tr>
      )}
      {open && (
        <tr><td colSpan={6} className="pb-3">
          {detail.isPending && <Skeleton className="h-12" />}
          {detail.isError && <Banner tone="warn" title="The proposal detail is unavailable">{detail.error instanceof Error ? detail.error.message : 'The detail read failed.'}</Banner>}
          {detail.data && (
            <div className="space-y-2">
              <p className="text-xs text-muted">Rationale: {detail.data.rationale ?? '—'} · Canonical snapshot: {detail.data.canonicalCurrent === true ? 'current' : detail.data.canonicalCurrent === false ? 'drifted' : 'unchecked'}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <pre aria-label={`Base body for ${current.skillName}`} className="max-h-48 overflow-auto rounded bg-black/5 p-2 text-[10px] whitespace-pre-wrap">{detail.data.baseBody}</pre>
                <pre aria-label={`Proposed body for ${current.skillName}`} className="max-h-48 overflow-auto rounded bg-black/5 p-2 text-[10px] whitespace-pre-wrap">{detail.data.proposedBody}</pre>
              </div>
              <div className="text-[10px] text-muted">
                {detail.data.reviews.map((r) => <div key={r.id}>{r.decision} by {r.reviewerId} (v{r.proposalVersion}){r.comment ? `: ${r.comment}` : ''}</div>)}
              </div>
            </div>
          )}
        </td></tr>
      )}
      {body !== null && current.status === 'draft' && (
        <tr><td colSpan={6} className="pb-3">
          <Textarea aria-label={`Amended body for ${current.skillName}`} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="mt-2 flex gap-2">
            <Button variant="primary" disabled={busy.isPending} onClick={() => busy.mutate({ kind: 'amend' })}>Save amendment (v{current.version + 1})</Button>
            <Button variant="secondary" onClick={() => setBody(null)}>Cancel</Button>
          </span>
        </td></tr>
      )}
      {current.status === 'proposed' && (
        <tr><td colSpan={6} className="pb-3">
          <Input aria-label={`Decision comment for ${current.skillName}`} maxLength={500} placeholder="Decision comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        </td></tr>
      )}
      {exported !== null && (
        <tr><td colSpan={6} className="pb-3">
          <Banner tone="info" title={`Export for ${exported.proposal.skillName} v${exported.proposal.version}`}>
            {exported.publicationContract.join(' ')}
          </Banner>
        </td></tr>
      )}
    </>
  )
}
