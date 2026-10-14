/**
 * Real tradecraft library (integration ticket 14). Skill and technique
 * concepts resolve through the knowledge graph's public contract — the
 * canonical runtime corpus — so no second browser corpus is created here.
 * Revision writes have no web contract on purpose (the corpus changes through
 * the runtime's own git-based workflow) and render as a recorded exclusion.
 */
import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { fetchLibrary } from '../api'
import { Banner, Button, Card, CardHeader, Empty, Input, PageHeader, Skeleton } from '../../ui'

export function RealLibrary(): ReactElement {
  const library = useQuery({
    queryKey: ['real', 'library'],
    queryFn: () => fetchLibrary(),
  })
  const [filter, setFilter] = useState('')

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
      <Banner tone="warn" title="Library revisions are excluded by corpus ownership">
        Skill corpus data changes through the runtime's own git-based workflow, not through the browser. Submitting or reviewing library revisions from this surface has no contract on purpose — recording this exclusion beats forking a second corpus. Excluded: {view.excludedActions.join(', ')}.
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
                {skills.slice(0, 100).map((s) => (
                  <tr key={s.name} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{s.name}</td>
                    <td className="py-2 pr-3 text-xs">{s.subdomain ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs">{s.mitreIds.length === 0 ? '—' : s.mitreIds.join(', ')}</td>
                    <td className="py-2 text-xs text-muted">{s.description === null ? '—' : s.description.slice(0, 160)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <p className="text-xs text-neutral">A displayed technique is reference material only — availability in the library never implies execution authorization.</p>
    </div>
  )
}
