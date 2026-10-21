/**
 * Global search / command palette (ticket 08b, extracted from the shell
 * monolith verbatim). Results are scoped reads from the shared store; recent
 * searches stay session-local module state exactly as before.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, History, Search } from 'lucide-react'
import { go } from '../router/navigate'
import { useActiveProject } from '../state/console'
import { useServiceProjection } from '../state/projection'
import { readSearchResults } from '../features/navigation/service'
import { IconButton, cx } from '../ui/index'
import { NAV } from './nav'

let RECENT: string[] = []
type Hit = { group: string; id: string; label: string; meta?: string; to: () => void }
const GROUP_ORDER = ['Projects', 'Operations', 'Plans', 'Findings', 'Sessions', 'Agents', 'Pages']
export function GlobalSearch() {
  const project = useActiveProject()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const results = useServiceProjection((services, ctx) => readSearchResults(services, ctx, q))
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])
  useEffect(() => setIdx(0), [q])
  const hits = useMemo<Hit[]>(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    const m = (...s: (string | undefined)[]) => s.join(' ').toLowerCase().includes(k)
    const all: Hit[] = [
      ...results.map((hit) => ({ ...hit, to: () => go(hit.page, { id: hit.id }) })),
      ...NAV.flatMap((g) => g.items).filter((i) => m(i.label, i.page)).map((i) => ({ group: 'Pages', id: i.label, label: 'Open page', to: () => go(i.page) })),
    ]
    return GROUP_ORDER.flatMap((g) => all.filter((h) => h.group === g).slice(0, 4))
    /* `go` is the navigate module's stable function (an outer-scope value, not
       a dependency): the memo is pure over its data inputs, as before. */
  }, [q, results])
  const choose = (h: Hit) => {
    const k = q.trim()
    if (k) RECENT = [k, ...RECENT.filter((x) => x !== k)].slice(0, 5)
    setOpen(false)
    h.to()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && hits[idx]) { e.preventDefault(); choose(hits[idx]) }
  }
  const groups = GROUP_ORDER.filter((g) => hits.some((h) => h.group === g))
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search (Ctrl+K)" className="flex h-10 min-w-0 max-w-md flex-1 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm text-neutral hover:bg-hover max-md:hidden">
        <Search size={16} aria-hidden />
        <span className="flex-1 truncate text-left">Search projects, operations, plans…</span>
        <kbd className="rounded border border-line bg-subtle px-1.5 font-mono text-xs text-muted max-xl:hidden">⌘K</kbd>
      </button>
      <IconButton icon={Search} label="Search" onClick={() => setOpen(true)} className="md:hidden" />
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[10vh]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label="Global search" onKeyDown={onKey} className="relative flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={18} className="shrink-0 text-neutral" aria-hidden />
              <input ref={inputRef} role="combobox" aria-expanded aria-controls="cmdk-list" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects, operations, plans, findings, sessions, agents, pages…" className="h-14 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-neutral" />
              <span className="shrink-0 rounded-full border border-line bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">{project ? project.id : 'All accessible projects'}</span>
            </div>
            <div id="cmdk-list" role="listbox" className="no-scrollbar flex-1 overflow-y-auto p-2">
              {!q.trim() ? (
                <div className="px-2 py-2">
                  <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-neutral">Recent searches</div>
                  {RECENT.length === 0 ? <div className="px-1 py-3 text-sm text-muted">No recent searches. Type to search within {project ? project.id : 'all accessible projects'}.</div> : RECENT.map((r) => (
                    <button key={r} onClick={() => setQ(r)} className="flex h-10 w-full items-center gap-3 rounded-[10px] px-2 text-left text-sm hover:bg-hover"><History size={15} className="text-neutral" aria-hidden />{r}</button>
                  ))}
                </div>
              ) : hits.length === 0 ? (
                <div className="px-4 py-10 text-center"><div className="text-sm font-semibold">No results</div><div className="mt-1 text-sm text-muted">Try a project ID, operation name or agent hostname{project ? ', or switch to All Projects' : ''}.</div></div>
              ) : groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-neutral">{g}</div>
                  {hits.map((h, i) => h.group === g && (
                    <button key={h.group + h.id} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => choose(h)} className={cx('flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm', i === idx ? 'bg-accent-soft' : 'hover:bg-hover')}>
                      <span className={cx('whitespace-nowrap text-[13px]', h.group !== 'Pages' && 'font-mono')}>{h.id}</span><span className="min-w-0 flex-1 truncate text-muted">{h.label}</span>{h.meta && <span className="shrink-0 whitespace-nowrap text-xs text-neutral max-sm:hidden">{h.meta}</span>}
                      {i === idx && <CornerDownLeft size={14} className="text-neutral" aria-hidden />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-muted"><span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span></div>
          </div>
        </div>
      )}
    </>
  )
}
