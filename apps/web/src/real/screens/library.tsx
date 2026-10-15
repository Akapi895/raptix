/**
 * Real tradecraft library (integration ticket 14). Skill and technique
 * concepts resolve through the knowledge graph's public contract — the
 * canonical runtime corpus — so no second browser corpus is created here.
 * Detail reads fetch the canonical node (body, commit, digest); revision
 * proposals are not a web contract on purpose (the corpus changes through
 * the runtime's own git-based workflow) and render as a recorded exclusion.
 */
import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { fetchLibrary, fetchLibrarySkill, fetchLibraryTechnique } from '../api'
import { go, useRoute } from '../../router/navigate'
import { Banner, Button, Card, CardHeader, Empty, Input, PageHeader, Skeleton } from '../../ui'

export function RealLibrary(): ReactElement {
  const route = useRoute()
  if ((route.page === 'playbook' || route.page === 'technique') && route.id) {
    return route.page === 'playbook'
      ? <SkillDetail name={route.id} />
      : <TechniqueDetail id={route.id} />
  }
  return <LibraryList />
}

function SkillDetail({ name }: { name: string }): ReactElement {
  const detail = useQuery({ queryKey: ['real', 'library-skill', name], queryFn: () => fetchLibrarySkill(name), retry: false })
  if (detail.isPending) {
    return <Card><CardHeader title={`Skill ${name}`} /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (detail.isError || !detail.data) {
    return <Empty icon={BookOpen} title={`Skill ${name} is unavailable`} action={<Button onClick={() => void detail.refetch()}>Retry</Button>}>
      {detail.error instanceof Error ? detail.error.message : 'The canonical skill read failed.'}
    </Empty>
  }
  const d = detail.data
  return (
    <div className="space-y-4">
      <PageHeader title={`Skill: ${d.name}`} sub={`${d.subdomain ?? 'no subdomain'} · publication ${d.publication}${d.commitSha === null ? '' : ` · commit ${d.commitSha}`}${d.contentSha256 === null ? '' : ` · sha256 ${d.contentSha256.slice(0, 16)}…`}`} />
      <div className="flex flex-wrap gap-2 text-xs">
        {d.mitreIds.map((id) => <Button key={id} variant="secondary" onClick={() => go('technique', { id })}>{id}</Button>)}
        <Button variant="secondary" onClick={() => go('playbook-review')}>Propose a body replacement</Button>
      </div>
      {d.whenToUse !== null && <Banner tone="info" title="When to use">{d.whenToUse}</Banner>}
      <Card>
        <CardHeader title="Canonical SKILL.md body" sub={d.path ?? 'path unavailable in the graph'} />
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">{d.body}</pre>
      </Card>
      <p className="text-xs text-neutral">A displayed skill is reference material only — availability in the library never implies execution authorization.</p>
    </div>
  )
}

function TechniqueDetail({ id }: { id: string }): ReactElement {
  const detail = useQuery({ queryKey: ['real', 'library-technique', id], queryFn: () => fetchLibraryTechnique(id), retry: false })
  if (detail.isPending) {
    return <Card><CardHeader title={`Technique ${id}`} /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (detail.isError || !detail.data) {
    return <Empty icon={BookOpen} title={`Technique ${id} is unavailable`} action={<Button onClick={() => void detail.refetch()}>Retry</Button>}>
      {detail.error instanceof Error ? detail.error.message : 'The canonical technique read failed.'}
    </Empty>
  }
  const d = detail.data
  return (
    <div className="space-y-4">
      <PageHeader title={`Technique ${d.id}${d.name === null ? '' : `: ${d.name}`}`} sub={d.url ?? 'Canonical MITRE technique reference from the knowledge graph'} />
      <Card>
        <CardHeader title="Description" />
        <p className="p-4 text-sm">{d.description ?? 'No description is published for this technique node.'}</p>
      </Card>
      <Card>
        <CardHeader title={`Corpus skills covering this technique (${d.skills.length})`} />
        <div className="p-4">
          {d.skills.length === 0 ? (
            <p className="text-sm text-muted">No skill in the canonical corpus declares this technique.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {d.skills.map((s) => <li key={s.name}><Button variant="secondary" onClick={() => go('playbook', { id: s.name })}>{s.name}</Button></li>)}
            </ul>
          )}
        </div>
      </Card>
      <p className="text-xs text-neutral">A displayed technique is reference material only — availability in the library never implies execution authorization.</p>
    </div>
  )
}

function LibraryList(): ReactElement {
  const library = useQuery({
    queryKey: ['real', 'library'],
    queryFn: () => fetchLibrary(),
  })
  const [filter, setFilter] = useState('')
  // W18: an explicit load-more pages long lists instead of silently cutting at 100.
  const [visible, setVisible] = useState(100)

  if (library.isPending) {
    return <Card><CardHeader title="Tradecraft library" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  }
  if (library.isError || !library.data) {
    return <Empty icon={BookOpen} title="The library is unavailable" action={<Button onClick={() => void library.refetch()}>Retry</Button>}>
      {library.error instanceof Error ? library.error.message : 'The corpus read failed.'}
    </Empty>
  }
  const view = library.data
  const needle = filter.trim().toLowerCase()
  const skills = needle.length === 0 ? view.skills : view.skills.filter((s) =>
    s.name.toLowerCase().includes(needle) ||
    (s.subdomain ?? '').includes(needle) ||
    (s.description ?? '').toLowerCase().includes(needle) ||
    s.mitreIds.some((id) => id.toLowerCase().includes(needle)))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tradecraft library"
        sub={`${view.counts.skills} skill document(s)${view.counts.techniques === null ? '' : ` · ${view.counts.techniques} corpus technique(s)`} — resolved from the knowledge graph (source: ${view.sources.skills}); the corpus stays owned by the runtime`}
      />
      <Banner tone="info" title="Body-replacement proposals run through the engagement-scoped review workflow">
        Skill corpus data still changes only through the runtime's git-based publication gates. A review surface submits, amends and reviews pinned body-replacement proposals per engagement; an approved export feeds that git workflow — the browser never mutates the corpus. Proposal actions excluded from the library surface itself: {view.excludedActions.join(', ')}.
        <div className="mt-2">
          <Button variant="secondary" onClick={() => go('playbook-review')}>Open proposal queue</Button>
        </div>
      </Banner>
      <Card>
        <CardHeader title={`Skill documents${view.counts.skills > view.skills.length ? ` (showing ${view.skills.length} of ${view.counts.skills})` : ''}`} />
        <div className="p-4">
          <div className="mb-3">
            <Input aria-label="Filter skills" placeholder="Filter by name, subdomain, description or MITRE id" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {skills.length === 0 ? (
            <p className="text-sm text-muted">{needle.length === 0 ? 'The graph exposes no skill documents.' : 'No skill matches this filter.'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Skill</th>
                  <th className="pb-2">Subdomain</th>
                  <th className="pb-2">MITRE</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {skills.slice(0, visible).map((s) => (
                  <tr key={s.name} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs"><button onClick={() => go('playbook', { id: s.name })}>{s.name}</button></td>
                    <td className="py-2 pr-3 text-xs">{s.subdomain ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs">{s.mitreIds.length === 0 ? '—' : s.mitreIds.map((id) => <button className="mr-2 underline" key={id} onClick={() => go('technique', { id })}>{id}</button>)}</td>
                    <td className="py-2 text-xs text-muted">{s.description === null ? '—' : s.description.slice(0, 160)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {skills.length > visible && (
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setVisible((v) => v + 100)}>Show more skills ({visible} of {skills.length})</Button>
            </div>
          )}
        </div>
      </Card>
      <p className="text-xs text-neutral">A displayed technique is reference material only — availability in the library never implies execution authorization.</p>
    </div>
  )
}
