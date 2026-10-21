/** Search the authorized portfolio and pending-work projection, without a demo index. */
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { fetchTasks } from '../../features/overview/remote';
import { useRealProjects } from '../queries'
import { go } from '../../router/navigate'
import { parseHash } from '../../router/history'
import { Input } from '../../ui/index'

export function RealSearch(): ReactElement {
  const [query, setQuery] = useState('')
  const { list } = useRealProjects()
  const tasks = useQuery({ queryKey: ['real', 'tasks'], queryFn: fetchTasks, enabled: query.trim().length > 1 })
  const needle = query.trim().toLowerCase()
  const projects = (list.data ?? []).filter((p) => `${p.id} ${p.displayName} ${p.targetValue}`.toLowerCase().includes(needle))
  const matches = (tasks.data?.tasks ?? []).filter((t) => `${t.title} ${t.kind} ${t.engagementName}`.toLowerCase().includes(needle))
  return <div className="relative min-w-0 max-w-sm flex-1">
    <Input aria-label="Search engagements and tasks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search engagements and tasks" />
    {needle.length > 1 && <div className="absolute top-full z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-panel p-2 shadow-xl" aria-label="Search results">
      {list.isError || tasks.isError ? <p role="alert">Search source unavailable. Retry from Projects or Tasks.</p> : <>
        {projects.slice(0, 8).map((p) => <button key={p.id} className="block w-full p-2 text-left text-sm hover:bg-hover" onClick={() => { setQuery(''); go('project', { id: p.id }) }}>{p.displayName}</button>)}
        {matches.slice(0, 8).map((t) => <button key={`${t.kind}/${t.refId}`} className="block w-full p-2 text-left text-sm hover:bg-hover" onClick={() => { const route = parseHash(t.href); setQuery(''); go(route.page, route) }}>{t.kind}: {t.title}</button>)}
        {!tasks.isPending && projects.length + matches.length === 0 && <p>No matching authorized engagements or tasks.</p>}
      </>}
      <button className="p-2 text-sm underline" onClick={() => setQuery('')}>Close search</button>
    </div>}
  </div>
}
